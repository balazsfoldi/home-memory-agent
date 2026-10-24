import { randomUUID } from 'node:crypto';
import type { AgentToolName } from '@home-memory/shared';
import type { MemoryRepository } from '../domain/memory-repository.js';
import type { AutomationRepository } from '../domain/automation-repository.js';
import type { LlmProvider } from '../domain/llm-provider.js';
import type { EmbeddingProvider } from '../domain/embedding-provider.js';
import { AgentToolRegistry } from './agent-tool-registry.js';
import { ChatService } from './chat-service.js';
import { MemoryService } from './memory-service.js';
import { MemorySearchService } from './memory-search-service.js';
import { createOpenMeteoWeatherTool } from '../infrastructure/tools/open-meteo-weather-tool.js';
import { createIcsCalendarTool } from '../infrastructure/tools/ics-calendar-tool.js';
import { createNotesSearchTool } from '../infrastructure/tools/notes-search-tool.js';
import { AutomationService } from './automation-service.js';

export interface MemoryApplicationServices {
  memories: MemoryService;
  chat: ChatService;
  repository: MemoryRepository;
  automations: AutomationService;
  requestIdFactory: () => string;
}

export function createMemoryApplicationServices(options: {
  repository: MemoryRepository;
  automationRepository: AutomationRepository;
  provider?: LlmProvider;
  embeddingProvider?: EmbeddingProvider;
  agentTools?: AgentToolName[];
  dataDirectory?: string;
  providerConfigured: boolean;
  model: string;
}): MemoryApplicationServices {
  const search = new MemorySearchService(options.repository, options.embeddingProvider);
  const toolRegistry = new AgentToolRegistry(
    [
      createOpenMeteoWeatherTool(),
      createIcsCalendarTool(options.dataDirectory ?? process.cwd()),
      createNotesSearchTool(options.repository, search),
    ],
    options.agentTools ?? [],
  );
  const automations = new AutomationService(
    options.automationRepository,
    options.repository,
    options.provider,
    options.providerConfigured,
    options.model,
    search,
    toolRegistry,
  );
  return {
    repository: options.repository,
    automations,
    memories: new MemoryService(options.repository, undefined, undefined, search, (event) =>
      automations.onMemoryEvent(event),
    ),
    chat: new ChatService(
      options.repository,
      options.provider,
      options.providerConfigured,
      options.model,
      undefined,
      search,
      toolRegistry,
    ),
    requestIdFactory: randomUUID,
  };
}
