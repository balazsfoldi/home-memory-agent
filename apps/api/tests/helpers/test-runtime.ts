import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { loadConfig } from '../../src/config.js';
import type { AppConfig } from '../../src/config.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../../src/domain/llm-provider.js';
import type { MemoryRepository } from '../../src/domain/memory-repository.js';
import { JsonMemoryRepository } from '../../src/infrastructure/persistence/json-memory-repository.js';
import { createMemoryApplicationServices } from '../../src/application/repository-memory-service.js';
import { createApplication } from '../../src/http/application.js';

export class FakeLlmProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;
  readonly requests: LlmRequest[] = [];
  readonly responses: string[] = [];
  responder?: (request: LlmRequest) => Promise<string>;

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    if (this.responder) return { content: await this.responder(request) };
    return {
      content: this.responses.shift() ?? JSON.stringify({ kind: 'answer', message: 'Szia!' }),
    };
  }
}

export interface TestRuntime {
  app: Express;
  config: AppConfig;
  provider: FakeLlmProvider;
  repository: MemoryRepository;
  close(): Promise<void>;
}

export async function createTestRuntime(
  options: {
    provider?: boolean;
    dataDirectory?: string;
    repository?: MemoryRepository;
  } = {},
): Promise<TestRuntime> {
  const dataDirectory =
    options.dataDirectory ?? (await mkdtemp(path.join(process.cwd(), 'data', 'hmem-test-')));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_PATH: dataDirectory,
    MEMORY_STORE: 'json',
    LLM_PROVIDER: options.provider === false ? 'none' : 'openai-compatible',
    LLM_BASE_URL: options.provider === false ? '' : 'https://example.invalid/v1',
    LLM_API_KEY: options.provider === false ? '' : 'test-only-key',
    LLM_MODEL: options.provider === false ? '' : 'fixture-model',
    OPENAI_STRUCTURED_OUTPUT: 'true',
  });
  const repository = options.repository ?? new JsonMemoryRepository(dataDirectory);
  await repository.initialize();
  const provider = new FakeLlmProvider();
  const services = createMemoryApplicationServices({
    repository,
    providerConfigured: options.provider !== false,
    model: config.model,
    ...(options.provider === false ? {} : { provider }),
  });
  const app = createApplication(config, services);
  return {
    app,
    config,
    provider,
    repository,
    close: async () => {
      await repository.close();
      if (!options.dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}
