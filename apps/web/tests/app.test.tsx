import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';

const memory = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'Utazás',
  content: 'Csendes, természetközeli szállásokat keresek.',
  priority: 'normal' as const,
  createdAt: '2026-10-21T18:00:00.000Z',
  updatedAt: '2026-10-21T18:00:00.000Z',
  expiresAt: null,
  archivedAt: null,
};

describe('Home Memory web interface', () => {
  let memories: (typeof memory)[];
  let configured: boolean;
  let reportedTools: string[];
  const fetcher = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.localStorage.clear();
    memories = [];
    configured = false;
    reportedTools = [];
    fetcher.mockReset().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/memories/export') {
        return new Response(
          JSON.stringify({
            format: 'home-memory-agent',
            version: 1,
            exportedAt: '2026-10-21T18:00:00.000Z',
            memories,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/memories/import' && init?.method === 'POST') {
        const document = JSON.parse(String(init.body)) as {
          memories: Array<{
            category: string;
            content: string;
            priority?: 'low' | 'normal' | 'high';
          }>;
        };
        let imported = 0;
        let skipped = 0;
        for (const item of document.memories) {
          if (
            memories.some(
              (stored) => stored.category === item.category && stored.content === item.content,
            )
          ) {
            skipped += 1;
            continue;
          }
          memories.push({
            ...memory,
            id: `11111111-1111-4111-8111-${String(memories.length + 1).padStart(12, '0')}`,
            category: item.category,
            content: item.content,
            priority: item.priority ?? 'normal',
          });
          imported += 1;
        }
        return new Response(JSON.stringify({ imported, skipped }), { status: 200 });
      }
      if (url === '/api/settings') {
        return new Response(
          JSON.stringify({
            provider: configured ? 'openai-compatible' : 'none',
            model: configured ? 'fixture-model' : '',
            configured,
            structuredProposals: false,
            externalDataNotice: 'A memóriákat helyben kezeled.',
            embeddingProvider: 'none',
            embeddingModel: '',
            embeddingConfigured: false,
            storageProvider: 'sqlite',
            semanticSearch: false,
            agentTools: [
              { name: 'weather.getForecast', enabled: false },
              { name: 'calendar.getEvents', enabled: false },
              { name: 'notes.search', enabled: false },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/memories') && (!init?.method || init.method === 'GET')) {
        const query = new URL(url, 'http://local').searchParams.get('q')?.toLowerCase();
        const view = new URL(url, 'http://local').searchParams.get('view') ?? 'active';
        const items = query
          ? memories.filter((item) =>
              `${item.category} ${item.content}`.toLowerCase().includes(query),
            )
          : memories;
        const visible = items.filter((item) =>
          view === 'all'
            ? true
            : view === 'archived'
              ? Boolean(item.archivedAt)
              : !item.archivedAt,
        );
        return new Response(
          JSON.stringify({
            items: visible.map((item) => ({
              memory: item,
              etag: '"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
            })),
            total: visible.length,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/memories' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          category: string;
          content: string;
          priority: 'low' | 'normal' | 'high';
        };
        const created = {
          ...memory,
          category: body.category,
          content: body.content,
          priority: body.priority,
          id: '11111111-1111-4111-8111-111111111111',
        };
        memories = [created];
        return new Response(
          JSON.stringify({
            memory: created,
            etag: '"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
          }),
          { status: 201 },
        );
      }
      if (url === '/api/chat' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            message: 'Ezt szívesen megjegyzem.',
            conversationId: 'conversation-123456',
            usedMemoryIds: [],
            toolsUsed: reportedTools,
            proposal: {
              action: {
                action: 'CREATE_MEMORY',
                memory: {
                  category: 'Utazás',
                  content: 'Csendes helyeket szeretek.',
                  priority: 'normal',
                },
              },
              currentMemory: null,
              etag: null,
              source: 'automatic',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 'REQUEST_FAILED',
            message: 'Unexpected test request.',
            requestId: 'test',
          },
        }),
        { status: 404 },
      );
    });
    vi.stubGlobal('fetch', fetcher);
  });

  async function renderHungarian(): Promise<void> {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'I remember what matters.' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), {
      target: { value: 'hu' },
    });
    expect(
      await screen.findByRole('heading', { name: 'Emlékszem, ami fontos.' }),
    ).toBeInTheDocument();
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses English by default and remembers a Hungarian language choice', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'I remember what matters.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My memories/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByRole('heading', { name: 'On your own storage.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Your memories stay yours.')).toBeInTheDocument();
    expect(screen.getByText('You manage your memories locally.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), {
      target: { value: 'hu' },
    });
    expect(
      await screen.findByRole('heading', { name: 'Emlékszem, ami fontos.' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('home-memory-language')).toBe('hu');

    cleanup();
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Emlékszem, ami fontos.' }),
    ).toBeInTheDocument();
  });

  it('shows each agent operation permission and its data source in settings', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'I remember what matters.' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Agent tool permissions')).toBeInTheDocument();
    expect(screen.getByText('Weather forecast')).toBeInTheDocument();
    expect(screen.getByText('Calendar events')).toBeInTheDocument();
    expect(screen.getByText('Search memories')).toBeInTheDocument();
    expect(screen.getAllByText('Disabled')).toHaveLength(3);
    expect(
      screen.getByText('Calendar events are read from the local data/calendar.ics file.'),
    ).toBeInTheDocument();
  });

  it('shows the tools used alongside the assistant reply in Hungarian', async () => {
    configured = true;
    reportedTools = ['notes.search'];
    await renderHungarian();
    fireEvent.change(await screen.findByLabelText('Üzenet az asszisztensnek'), {
      target: { value: 'What do I prefer?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Üzenet küldése' }));
    expect(await screen.findByText('Használt eszközök: Emlékek keresése')).toBeInTheDocument();
  });

  it('creates and lists a memory through the accessible memory form', async () => {
    await renderHungarian();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    expect(await screen.findByRole('heading', { name: /Memóriák/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Új emlék' }));

    fireEvent.change(screen.getByLabelText('Kategória'), { target: { value: 'Utazás' } });
    fireEvent.change(screen.getByLabelText('Mi legyen az emlék?'), {
      target: { value: memory.content },
    });
    fireEvent.click(screen.getByRole('button', { name: /Emlék mentése/u }));

    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent(memory.content));
    expect(await screen.findByRole('status')).toHaveTextContent('elmentettük az emléket');
    expect(
      fetcher.mock.calls.some(
        ([input, init]) => String(input) === '/api/memories' && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('imports pasted JSON and adds the validated memories to the list', async () => {
    await renderHungarian();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Importálás' }));
    expect(
      await screen.findByRole('dialog', { name: 'Memóriák importálása' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Vagy illeszd be a JSON-t' }), {
      target: {
        value: JSON.stringify({
          format: 'home-memory-agent',
          version: 1,
          memories: [{ category: 'Utazás', content: 'Szeretem a csendes túraútvonalakat.' }],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Memóriák importálása' }));

    expect(await screen.findByText('Szeretem a csendes túraútvonalakat.')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Importálás kész: 1 új emlék, 0 egyező kihagyva.',
    );
    expect(
      fetcher.mock.calls.some(
        ([input, init]) => String(input) === '/api/memories/import' && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('loads an uploaded JSON file into the import form', async () => {
    await renderHungarian();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Importálás' }));
    const contents = JSON.stringify({
      format: 'home-memory-agent',
      version: 1,
      memories: [{ category: 'Otthon', content: 'Szeretem a csendet reggel.' }],
    });
    const file = new File([contents], 'memories.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => contents });

    fireEvent.change(screen.getByLabelText('JSON-fájl kiválasztása'), {
      target: { files: [file] },
    });
    expect(
      await screen.findByRole('textbox', { name: 'Vagy illeszd be a JSON-t' }),
    ).toHaveValue(contents);
  });

  it('shows a copyable JSON export of the complete memory list', async () => {
    memories = [memory];
    await renderHungarian();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exportálás' }));

    const exportField = await screen.findByRole('textbox', {
      name: 'Exportált memóriák JSON-formátuma',
    });
    expect((exportField as HTMLTextAreaElement).value).toContain(memory.content);
    expect((exportField as HTMLTextAreaElement).value).toContain('home-memory-agent');
    expect(screen.getByRole('button', { name: 'Másolás' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Letöltés JSON-ként' })).toBeEnabled();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Másolás' }));
      expect(await screen.findByText('Az exportot a vágólapra másoltuk.')).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith((exportField as HTMLTextAreaElement).value);
    } finally {
      if (clipboardDescriptor)
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }

    const createUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const createObjectURL = vi.fn(() => 'blob:memory-export');
    const revokeObjectURL = vi.fn();
    const clickLink = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Letöltés JSON-ként' }));
      expect(await screen.findByText('Az exportfájl letöltése elindult.')).toBeInTheDocument();
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(clickLink).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:memory-export');
    } finally {
      clickLink.mockRestore();
      if (createUrlDescriptor)
        Object.defineProperty(URL, 'createObjectURL', createUrlDescriptor);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (revokeUrlDescriptor)
        Object.defineProperty(URL, 'revokeObjectURL', revokeUrlDescriptor);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('explains that the memory list works while the assistant awaits a provider', async () => {
    await renderHungarian();
    expect(await screen.findByText('Az asszisztens beállításra vár')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Üzenet küldése' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Beállítások/u }));
    expect(
      await screen.findByRole('heading', { name: 'A saját tárhelyeden.' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('API-kulcs nem kerül a böngészőbe.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/API.kulcs|API key/u)).not.toBeInTheDocument();
  });

  it('displays stored content as text and supports search', async () => {
    memories = [memory];
    await renderHungarian();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    expect(await screen.findByText(memory.content)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keresés az emlékek között'), {
      target: { value: 'tengerpart' },
    });
    await waitFor(() =>
      expect(screen.getByText('Nem találtam egyező emléket.')).toBeInTheDocument(),
    );
  });

  it('lets the user edit an automatic memory suggestion before approving it', async () => {
    configured = true;
    await renderHungarian();
    fireEvent.change(await screen.findByLabelText('Üzenet az asszisztensnek'), {
      target: { value: 'I usually like quiet places when travelling.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Üzenet küldése' }));
    expect(
      await screen.findByText('Automatikus emlékötlet', { exact: false }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Javaslat szerkesztése' }));
    fireEvent.change(screen.getByLabelText('Javasolt emlék'), {
      target: { value: 'Utazáskor csendes, természetközeli helyeket keresek.' },
    });
    fireEvent.change(screen.getByLabelText('Prioritás'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítás alkalmazása' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jóváhagyom' }));
    await screen.findByText(/A régi beszélgetési előzményt töröltük/u);
    const createRequest = fetcher.mock.calls.find(
      ([input, init]) => String(input) === '/api/memories' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      category: 'Utazás',
      content: 'Utazáskor csendes, természetközeli helyeket keresek.',
      priority: 'high',
    });
  });
});
