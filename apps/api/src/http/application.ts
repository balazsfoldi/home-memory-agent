import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import {
  AGENT_TOOL_NAMES,
  automationStatusInputSchema,
  chatRequestSchema,
  createAutomationInputSchema,
  createMemoryInputSchema,
  memoryImportDocumentSchema,
  updateMemoryInputSchema,
} from '@home-memory/shared';
import { hasConfiguredEmbeddingProvider } from '../config.js';
import type { AppConfig } from '../config.js';
import { ApplicationError } from '../domain/errors.js';
import type { MemoryApplicationServices } from '../application/repository-memory-service.js';

const projectRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const publicWebDirectory = resolve(projectRoot, 'apps/web/dist');
const API_BODY_LIMIT = '32kb';
const MEMORY_IMPORT_BODY_LIMIT = '5mb';

interface RateBucket {
  count: number;
  startedAt: number;
}

function rejectInvalidOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get('origin');
  if (!origin) {
    next();
    return;
  }
  try {
    if (new URL(origin).host === request.get('host')) {
      next();
      return;
    }
  } catch {
    // Malformed origins are rejected below without including their text in a response or log.
  }
  response.status(403).json({
    error: {
      code: 'INVALID_ORIGIN',
      message: 'A kérés forrása nem engedélyezett.',
      requestId: response.locals.requestId,
    },
  });
}

function rateLimitChat(): express.RequestHandler {
  const buckets = new Map<string, RateBucket>();
  return (request, response, next) => {
    const now = Date.now();
    const address = request.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(address);
    if (!bucket || now - bucket.startedAt >= 60_000) {
      bucket = { count: 0, startedAt: now };
      buckets.set(address, bucket);
    }
    bucket.count += 1;
    if (bucket.count > 20) {
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Túl sok kérés érkezett. Próbáld újra később.',
          requestId: response.locals.requestId,
        },
      });
      return;
    }
    if (buckets.size > 500) {
      for (const [key, value] of buckets)
        if (now - value.startedAt >= 60_000) buckets.delete(key);
    }
    next();
  };
}

function parseQueryInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{1,6}$/u.test(value)) {
    throw new ApplicationError(
      'INVALID_INPUT',
      'A lista korlátozó paraméterei érvénytelenek.',
      400,
    );
  }
  const parsed = Number(value);
  if (parsed > maximum)
    throw new ApplicationError(
      'INVALID_INPUT',
      'A lista korlátozó paraméterei érvénytelenek.',
      400,
    );
  return parsed;
}

function requireStrongEtag(request: Request): string {
  const header = request.get('if-match');
  if (!header || !/^"sha256-[A-Za-z0-9_-]{43}"$/u.test(header)) {
    throw new ApplicationError(
      'PRECONDITION_REQUIRED',
      'Frissítsd a memórialistát, mielőtt módosítod az emléket.',
      428,
    );
  }
  return header;
}

function responseEtag(response: Response, etag: string): void {
  response.setHeader('ETag', etag);
}

export function createApplication(
  config: AppConfig,
  services: MemoryApplicationServices,
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.disable('trust proxy');
  app.use((request, response, next) => {
    response.locals.requestId = services.requestIdFactory();
    response.setHeader('x-request-id', response.locals.requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    if (config.nodeEnv === 'production')
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    next();
  });
  app.use('/api', (_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  app.use(
    '/api/memories/import',
    express.json({ limit: MEMORY_IMPORT_BODY_LIMIT, strict: true }),
  );
  app.use(express.json({ limit: API_BODY_LIMIT, strict: true }));

  app.get('/api/health', (_request, response) => {
    const ready = services.repository.isReady;
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      memoryReady: ready,
      providerConfigured:
        config.provider !== 'none' &&
        Boolean(
          config.model &&
          config.baseUrl &&
          (config.provider !== 'openai-compatible' || config.apiKey),
        ),
    });
  });

  app.use('/api', (_request, response, next) => {
    if (!services.repository.isReady) {
      next(
        new ApplicationError(
          'STORAGE_UNAVAILABLE',
          'A memóriatár helyreállítás alatt áll. Próbáld újra később.',
          503,
        ),
      );
      return;
    }
    next();
  });

  app.get('/api/settings', (_request, response) => {
    const configured =
      config.provider !== 'none' &&
      Boolean(
        config.model &&
        config.baseUrl &&
        (config.provider !== 'openai-compatible' || config.apiKey),
      );
    const embeddingConfigured = hasConfiguredEmbeddingProvider(config);
    const notices = [
      configured
        ? config.provider === 'ollama'
          ? 'A beszélgetés és a kiválasztott emlékek a beállított Ollama-végpontnak is elküldhetők.'
          : 'A beszélgetés és a kiválasztott emlékek a beállított külső LLM-szolgáltatóhoz kerülnek.'
        : '',
      embeddingConfigured
        ? 'A keresőkifejezést és a mentett emlékek szövegét a beállított embedding-végpontnak küldi el a szemantikus indexeléshez.'
        : '',
    ].filter(Boolean);
    response.json({
      provider: config.provider,
      model: config.model,
      configured,
      structuredProposals: configured,
      externalDataNotice:
        notices.join(' ') ||
        'Nincs beállítva nyelvi modell. A memóriákat helyben, az alkalmazásból kezelheted.',
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      embeddingConfigured,
      storageProvider: config.storeProvider,
      semanticSearch: embeddingConfigured,
      agentTools: AGENT_TOOL_NAMES.map((name) => ({
        name,
        enabled: config.agentTools.includes(name),
      })),
    });
  });

  app.get('/api/automations', async (_request, response) => {
    response.json({ items: await services.automations.list() });
  });

  app.post('/api/automations', rejectInvalidOrigin, async (request, response) => {
    const input = createAutomationInputSchema.safeParse(request.body);
    if (!input.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Ellenőrizd az automatizálás nevét, leírását és indítását.',
        400,
      );
    response.status(201).json(await services.automations.create(input.data));
  });

  app.get('/api/automations/:id/runs', async (request, response) => {
    response.json({
      items: await services.automations.listRuns(
        typeof request.params.id === 'string' ? request.params.id : '',
      ),
    });
  });

  app.post('/api/automations/:id/run-now', rejectInvalidOrigin, async (request, response) => {
    response
      .status(202)
      .json(
        await services.automations.runNow(
          typeof request.params.id === 'string' ? request.params.id : '',
        ),
      );
  });

  app.patch('/api/automations/:id', rejectInvalidOrigin, async (request, response) => {
    const input = automationStatusInputSchema.safeParse(request.body);
    if (!input.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Az automatizálás állapota érvénytelen.',
        400,
      );
    response.json(
      await services.automations.setStatus(
        typeof request.params.id === 'string' ? request.params.id : '',
        input.data.status,
      ),
    );
  });

  app.delete('/api/automations/:id', rejectInvalidOrigin, async (request, response) => {
    await services.automations.delete(
      typeof request.params.id === 'string' ? request.params.id : '',
    );
    response.status(204).end();
  });

  app.get('/api/notifications', async (_request, response) => {
    response.json(await services.automations.notifications());
  });

  app.post('/api/notifications/:id/read', rejectInvalidOrigin, async (request, response) => {
    response.json(
      await services.automations.markNotificationRead(
        typeof request.params.id === 'string' ? request.params.id : '',
      ),
    );
  });

  app.get('/api/memories', async (request, response) => {
    const q = request.query.q;
    const category = request.query.category;
    const view = request.query.view;
    if (q !== undefined && (typeof q !== 'string' || q.length > 2_000))
      throw new ApplicationError('INVALID_INPUT', 'A keresőkifejezés érvénytelen.', 400);
    if (category !== undefined && (typeof category !== 'string' || category.length > 80))
      throw new ApplicationError('INVALID_INPUT', 'A kategória érvénytelen.', 400);
    if (
      view !== undefined &&
      (typeof view !== 'string' || !['active', 'archived', 'expired', 'all'].includes(view))
    )
      throw new ApplicationError('INVALID_INPUT', 'A memória nézete érvénytelen.', 400);
    const result = await services.memories.list({
      ...(typeof q === 'string' ? { q } : {}),
      ...(typeof category === 'string' ? { category } : {}),
      ...(typeof view === 'string'
        ? { view: view as 'active' | 'archived' | 'expired' | 'all' }
        : {}),
      limit: parseQueryInteger(request.query.limit, 50, 100),
      offset: parseQueryInteger(request.query.offset, 0, 100_000),
    });
    response.json(result);
  });

  app.get('/api/memories/export', async (_request, response) => {
    response.json(await services.memories.exportAll());
  });

  app.post('/api/memories/import', rejectInvalidOrigin, async (request, response) => {
    const document = memoryImportDocumentSchema.safeParse(request.body);
    if (!document.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Az importfájl nem megfelelő. Használd a Home Memory Agent JSON-formátumát; legfeljebb 500 emlék tölthető fel egyszerre.',
        400,
      );
    const result = await services.memories.importMany(document.data);
    if (result.imported > 0) services.chat.invalidateHistory();
    response.status(200).json(result);
  });

  app.post('/api/memories', rejectInvalidOrigin, async (request, response) => {
    const input = createMemoryInputSchema.safeParse(request.body);
    if (!input.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Ellenőrizd a kategóriát és a memória szövegét.',
        400,
      );
    const created = await services.memories.create(input.data);
    services.chat.invalidateHistory();
    responseEtag(response, created.etag);
    response.status(201).json(created);
  });

  app.get('/api/memories/:id', async (request, response) => {
    const item = await services.memories.get(
      typeof request.params.id === 'string' ? request.params.id : '',
    );
    responseEtag(response, item.etag);
    response.json(item);
  });

  app.put('/api/memories/:id', rejectInvalidOrigin, async (request, response) => {
    const input = updateMemoryInputSchema.safeParse(request.body);
    if (!input.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Ellenőrizd a kategóriát és a memória szövegét.',
        400,
      );
    const updated = await services.memories.update(
      typeof request.params.id === 'string' ? request.params.id : '',
      input.data,
      requireStrongEtag(request),
    );
    services.chat.invalidateHistory();
    responseEtag(response, updated.etag);
    response.json(updated);
  });

  app.post('/api/memories/:id/archive', rejectInvalidOrigin, async (request, response) => {
    const archived = await services.memories.archive(
      typeof request.params.id === 'string' ? request.params.id : '',
      requireStrongEtag(request),
    );
    services.chat.invalidateHistory();
    responseEtag(response, archived.etag);
    response.json(archived);
  });

  app.post('/api/memories/:id/restore', rejectInvalidOrigin, async (request, response) => {
    const restored = await services.memories.restore(
      typeof request.params.id === 'string' ? request.params.id : '',
      requireStrongEtag(request),
    );
    services.chat.invalidateHistory();
    responseEtag(response, restored.etag);
    response.json(restored);
  });

  app.delete('/api/memories/:id', rejectInvalidOrigin, async (request, response) => {
    await services.memories.delete(
      typeof request.params.id === 'string' ? request.params.id : '',
      requireStrongEtag(request),
    );
    services.chat.invalidateHistory();
    response.status(204).end();
  });

  app.post('/api/chat', rateLimitChat(), async (request, response) => {
    const input = chatRequestSchema.safeParse(request.body);
    if (!input.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Adj meg egy üzenetet, amely legfeljebb 8 000 karakter.',
        400,
      );
    const abortController = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    const result = await services.chat.chat({
      message: input.data.message,
      ...(input.data.conversationId !== undefined
        ? { conversationId: input.data.conversationId }
        : {}),
      ...(input.data.category !== undefined ? { category: input.data.category } : {}),
      signal: abortController.signal,
    });
    response.json(result);
  });

  app.use('/api', (_request, _response, next) => {
    next(new ApplicationError('INVALID_INPUT', 'Az API-végpont nem található.', 404));
  });

  app.use(
    express.static(publicWebDirectory, {
      index: false,
      maxAge: config.nodeEnv === 'production' ? '1h' : 0,
    }),
  );
  app.get('*splat', (request, response, next) => {
    if (request.accepts('html')) {
      response.sendFile(resolve(publicWebDirectory, 'index.html'), (error) => {
        if (error) next();
      });
      return;
    }
    next();
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    void next;
    const requestId =
      typeof response.locals.requestId === 'string' ? response.locals.requestId : randomUUID();
    if (error instanceof ApplicationError) {
      console.warn(JSON.stringify({ level: 'warn', requestId, code: error.code }));
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }
    const bodyError = error as { status?: number; type?: string; name?: string };
    if (bodyError.type === 'entity.too.large') {
      response
        .status(413)
        .json({ error: { code: 'BODY_TOO_LARGE', message: 'A kérés túl nagy.', requestId } });
      return;
    }
    if (
      bodyError.type === 'entity.parse.failed' ||
      (error instanceof SyntaxError && 'status' in error)
    ) {
      response.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'A kérés nem érvényes JSON.', requestId },
      });
      return;
    }
    console.error(
      JSON.stringify({
        level: 'error',
        requestId,
        code: 'INTERNAL_ERROR',
        name: bodyError.name ?? 'Error',
      }),
    );
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'A kérés feldolgozása nem sikerült.',
        requestId,
      },
    });
  };
  app.use(errorHandler);
  return app;
}
