import {
  automationListResponseSchema,
  automationNotificationListResponseSchema,
  automationNotificationSchema,
  automationRunListResponseSchema,
  automationRunSchema,
  automationSchema,
  apiErrorSchema,
  chatResponseSchema,
  memoryEnvelopeSchema,
  memoryExportDocumentSchema,
  memoryImportDocumentSchema,
  memoryImportResponseSchema,
  memoryListResponseSchema,
  settingsResponseSchema,
  type CreateMemoryInput,
  type CreateAutomationInput,
  type Automation,
  type AutomationNotification,
  type AutomationRun,
  type MemoryAction,
  type MemoryEnvelope,
  type MemoryExportDocument,
  type MemoryImportResponse,
  type MemoryListResponse,
  type SettingsResponse,
  type UpdateMemoryInput,
} from '@home-memory/shared';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      'Nem érhető el az alkalmazás. Ellenőrizd a kapcsolatot, és próbáld újra.',
    );
  }

  if (!response.ok) {
    let message = 'A kérés nem sikerült. Próbáld újra.';
    let code = 'REQUEST_FAILED';
    let details: Record<string, unknown> | undefined;
    try {
      const parsed = apiErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        message = parsed.data.error.message;
        code = parsed.data.error.code;
        details = parsed.data.error.details;
      }
    } catch {
      // The API error body is optional. Never show an unvalidated upstream response.
    }
    throw new ApiClientError(response.status, code, message, details);
  }
  return response;
}

export const api = {
  async listAutomations(): Promise<Automation[]> {
    const response = await request('/api/automations');
    const result = automationListResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data.items;
  },

  async createAutomation(input: CreateAutomationInput): Promise<Automation> {
    const response = await request('/api/automations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const result = automationSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data;
  },

  async setAutomationStatus(id: string, status: 'active' | 'paused'): Promise<Automation> {
    const response = await request(`/api/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    const result = automationSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data;
  },

  async deleteAutomation(id: string): Promise<void> {
    await request(`/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async runAutomationNow(id: string): Promise<AutomationRun> {
    const response = await request(`/api/automations/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
    });
    const result = automationRunSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data;
  },

  async automationRuns(id: string): Promise<AutomationRun[]> {
    const response = await request(`/api/automations/${encodeURIComponent(id)}/runs`);
    const result = automationRunListResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data.items;
  },

  async notifications(): Promise<{ items: AutomationNotification[]; unread: number }> {
    const response = await request('/api/notifications');
    const result = automationNotificationListResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data;
  },

  async markNotificationRead(id: string): Promise<AutomationNotification> {
    const response = await request(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    });
    const result = automationNotificationSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'The server returned invalid data.',
      );
    return result.data;
  },

  async listMemories(
    filter: {
      q?: string;
      category?: string;
      view?: 'active' | 'archived' | 'expired' | 'all';
    } = {},
  ): Promise<MemoryListResponse> {
    const query = new URLSearchParams();
    if (filter.q) query.set('q', filter.q);
    if (filter.category) query.set('category', filter.category);
    if (filter.view) query.set('view', filter.view);
    const response = await request(`/api/memories${query.size ? `?${query}` : ''}`);
    const result = memoryListResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async exportMemories(): Promise<MemoryExportDocument> {
    const response = await request('/api/memories/export');
    const result = memoryExportDocumentSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async importMemories(document: unknown): Promise<MemoryImportResponse> {
    const input = memoryImportDocumentSchema.safeParse(document);
    if (!input.success)
      throw new ApiClientError(
        400,
        'INVALID_INPUT',
        'Az importfájl nem megfelelő. Ellenőrizd a Home Memory Agent JSON-formátumát.',
      );
    const response = await request('/api/memories/import', {
      method: 'POST',
      body: JSON.stringify(input.data),
    });
    const result = memoryImportResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async createMemory(input: CreateMemoryInput): Promise<MemoryEnvelope> {
    const response = await request('/api/memories', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const result = memoryEnvelopeSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async updateMemory(
    id: string,
    etag: string,
    input: UpdateMemoryInput,
  ): Promise<MemoryEnvelope> {
    const response = await request(`/api/memories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'if-match': etag },
      body: JSON.stringify(input),
    });
    const result = memoryEnvelopeSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async deleteMemory(id: string, etag: string): Promise<void> {
    await request(`/api/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'if-match': etag },
    });
  },

  async archiveMemory(id: string, etag: string): Promise<MemoryEnvelope> {
    const response = await request(`/api/memories/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: { 'if-match': etag },
    });
    const result = memoryEnvelopeSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async restoreMemory(id: string, etag: string): Promise<MemoryEnvelope> {
    const response = await request(`/api/memories/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: { 'if-match': etag },
    });
    const result = memoryEnvelopeSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async chat(
    input: { message: string; conversationId?: string; category?: string },
    signal?: AbortSignal,
  ) {
    const response = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
    const result = chatResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },

  async settings(): Promise<SettingsResponse> {
    const response = await request('/api/settings');
    const result = settingsResponseSchema.safeParse(await response.json());
    if (!result.success)
      throw new ApiClientError(
        502,
        'INVALID_SERVER_RESPONSE',
        'A szerver érvénytelen adatot adott vissza.',
      );
    return result.data;
  },
};

export function proposalText(action: MemoryAction): { title: string; detail: string } {
  switch (action.action) {
    case 'CREATE_MEMORY':
      return { title: 'Új emlék', detail: action.memory.content };
    case 'UPDATE_MEMORY':
      return { title: 'Emlék módosítása', detail: action.memory.content };
    case 'DELETE_MEMORY':
      return {
        title: 'Emlék törlése',
        detail: 'A kiválasztott emlék eltávolítása a memóriatárból.',
      };
  }
}
