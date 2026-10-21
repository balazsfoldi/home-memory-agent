import { resolve } from 'node:path';
import type { AppConfig } from './config.js';
import { hasConfiguredProvider } from './config.js';
import type { MemoryRepository } from './domain/memory-repository.js';
import type { LlmProvider } from './domain/llm-provider.js';
import { createMemoryApplicationServices } from './application/repository-memory-service.js';
import { JsonMemoryRepository } from './infrastructure/persistence/json-memory-repository.js';
import { OllamaProvider } from './infrastructure/llm/ollama-provider.js';
import { OpenAiCompatibleProvider } from './infrastructure/llm/openai-compatible-provider.js';
import { createApplication } from './http/application.js';

export async function createRuntime(config: AppConfig, repository?: MemoryRepository) {
  const memoryRepository = repository ?? new JsonMemoryRepository(resolve(config.dataPath));
  await memoryRepository.initialize();
  let provider: LlmProvider | undefined;
  if (config.provider === 'openai-compatible') provider = new OpenAiCompatibleProvider(config);
  if (config.provider === 'ollama') provider = new OllamaProvider(config);
  const services = createMemoryApplicationServices({
    repository: memoryRepository,
    ...(provider ? { provider } : {}),
    providerConfigured: hasConfiguredProvider(config),
    model: config.model,
  });
  return {
    app: createApplication(config, services),
    repository: memoryRepository,
    close: () => memoryRepository.close(),
  };
}

export async function startServer(config: AppConfig): Promise<{ close: () => Promise<void> }> {
  const runtime = await createRuntime(config);
  const server = runtime.app.listen(config.port, config.host, () => {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'server_started',
        host: config.host,
        port: config.port,
      }),
    );
  });
  try {
    await new Promise<void>((resolveListening, rejectListening) => {
      server.once('error', rejectListening);
      server.once('listening', () => {
        server.off('error', rejectListening);
        resolveListening();
      });
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = new Promise<void>((resolveClose, rejectClose) => {
      server.close((serverError) => {
        void runtime
          .close()
          .then(() => (serverError ? rejectClose(serverError) : resolveClose()), rejectClose);
      });
      server.closeIdleConnections();
    });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    return closePromise;
  };
  const onSignal = () => {
    void close().catch((error: unknown) => {
      const name = error instanceof Error ? error.name : 'Error';
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', name }));
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return {
    close,
  };
}
