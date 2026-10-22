import { z } from 'zod';
import type { MemoryRepository } from '../../domain/memory-repository.js';
import type { MemorySearchService } from '../../application/memory-search-service.js';
import {
  defineAgentTool,
  type AgentToolDefinition,
} from '../../application/agent-tool-registry.js';

const notesSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(5).default(3),
  })
  .strict();

export function createNotesSearchTool(
  repository: MemoryRepository,
  search: MemorySearchService,
): AgentToolDefinition {
  return defineAgentTool({
    name: 'notes.search',
    description: 'Search active personal notes stored locally in this application.',
    inputExample: { query: 'weekend hiking preferences', limit: 3 },
    inputSchema: notesSearchInputSchema,
    async execute(input) {
      const now = Date.now();
      const memories = (await repository.list()).filter(
        (memory) =>
          memory.archivedAt === null &&
          (memory.expiresAt === null || Date.parse(memory.expiresAt) > now),
      );
      const results = await search.retrieve(input.query, memories, {
        limit: input.limit,
        maxContextCharacters: 3_000,
      });
      return {
        results: results.map(({ memory }) => ({
          category: memory.category,
          content: memory.content,
          priority: memory.priority,
        })),
      };
    },
  });
}
