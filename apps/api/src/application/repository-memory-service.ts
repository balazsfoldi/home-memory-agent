import { randomUUID } from 'node:crypto';
import type { MemoryRepository } from '../domain/memory-repository.js';
import type { LlmProvider } from '../domain/llm-provider.js';
import { ChatService } from './chat-service.js';
import { MemoryService } from './memory-service.js';

export interface MemoryApplicationServices {
  memories: MemoryService;
  chat: ChatService;
  repository: MemoryRepository;
  requestIdFactory: () => string;
}

export function createMemoryApplicationServices(options: {
  repository: MemoryRepository;
  provider?: LlmProvider;
  providerConfigured: boolean;
  model: string;
}): MemoryApplicationServices {
  return {
    repository: options.repository,
    memories: new MemoryService(options.repository),
    chat: new ChatService(
      options.repository,
      options.provider,
      options.providerConfigured,
      options.model,
    ),
    requestIdFactory: randomUUID,
  };
}
