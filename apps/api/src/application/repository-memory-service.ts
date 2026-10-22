import { randomUUID } from 'node:crypto';
import type { MemoryRepository } from '../domain/memory-repository.js';
import type { LlmProvider } from '../domain/llm-provider.js';
import type { EmbeddingProvider } from '../domain/embedding-provider.js';
import { ChatService } from './chat-service.js';
import { MemoryService } from './memory-service.js';
import { MemorySearchService } from './memory-search-service.js';

export interface MemoryApplicationServices {
  memories: MemoryService;
  chat: ChatService;
  repository: MemoryRepository;
  requestIdFactory: () => string;
}

export function createMemoryApplicationServices(options: {
  repository: MemoryRepository;
  provider?: LlmProvider;
  embeddingProvider?: EmbeddingProvider;
  providerConfigured: boolean;
  model: string;
}): MemoryApplicationServices {
  const search = new MemorySearchService(options.repository, options.embeddingProvider);
  return {
    repository: options.repository,
    memories: new MemoryService(options.repository, undefined, undefined, search),
    chat: new ChatService(
      options.repository,
      options.provider,
      options.providerConfigured,
      options.model,
      undefined,
      search,
    ),
    requestIdFactory: randomUUID,
  };
}
