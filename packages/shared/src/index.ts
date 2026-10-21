import { z } from 'zod';

export const MEMORY_CATEGORY_MAX_LENGTH = 80;
export const MEMORY_CONTENT_MAX_LENGTH = 2_000;
export const CHAT_MESSAGE_MAX_LENGTH = 8_000;

export const memoryPrioritySchema = z.enum(['low', 'normal', 'high']);
export type MemoryPriority = z.infer<typeof memoryPrioritySchema>;

export const memorySchema = z
  .object({
    id: z.uuid(),
    category: z.string().min(1).max(MEMORY_CATEGORY_MAX_LENGTH),
    content: z.string().min(1).max(MEMORY_CONTENT_MAX_LENGTH),
    priority: memoryPrioritySchema.default('normal'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Memory = z.infer<typeof memorySchema>;

export const createMemoryInputSchema = z
  .object({
    category: z.string().trim().min(1).max(MEMORY_CATEGORY_MAX_LENGTH),
    content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX_LENGTH),
    priority: memoryPrioritySchema.default('normal'),
  })
  .strict();

export type CreateMemoryInput = z.input<typeof createMemoryInputSchema>;

export const updateMemoryInputSchema = createMemoryInputSchema.extend({
  priority: memoryPrioritySchema.optional(),
});
export type UpdateMemoryInput = z.input<typeof updateMemoryInputSchema>;

export const chatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
    conversationId: z.string().min(12).max(80).optional(),
    category: z.string().trim().min(1).max(MEMORY_CATEGORY_MAX_LENGTH).optional(),
  })
  .strict();

export const memoryActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('CREATE_MEMORY'),
      memory: createMemoryInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('UPDATE_MEMORY'),
      id: z.uuid(),
      memory: updateMemoryInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('DELETE_MEMORY'),
      id: z.uuid(),
    })
    .strict(),
]);

export type MemoryAction = z.infer<typeof memoryActionSchema>;

export const agentDecisionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('answer'),
      message: z.string().min(1).max(8_000),
      memorySuggestion: createMemoryInputSchema.optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('clarification'), message: z.string().min(1).max(2_000) })
    .strict(),
  z.object({ kind: z.literal('proposal'), action: memoryActionSchema }).strict(),
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const chatResponseSchema = z
  .object({
    message: z.string(),
    conversationId: z.string(),
    usedMemoryIds: z.array(z.uuid()),
    proposal: z
      .object({
        action: memoryActionSchema,
        currentMemory: memorySchema.nullable(),
        etag: z.string().nullable(),
        source: z.enum(['explicit', 'automatic']).default('explicit'),
      })
      .nullable(),
    memoryContextChanged: z.boolean().optional(),
  })
  .strict();

export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

export const memoryEnvelopeSchema = z
  .object({ memory: memorySchema, etag: z.string() })
  .strict();

export type MemoryEnvelope = z.infer<typeof memoryEnvelopeSchema>;

export const memoryListResponseSchema = z
  .object({ items: z.array(memoryEnvelopeSchema), total: z.number().int().nonnegative() })
  .strict();

export type MemoryListResponse = z.infer<typeof memoryListResponseSchema>;

export const settingsResponseSchema = z
  .object({
    provider: z.enum(['none', 'openai-compatible', 'ollama']),
    model: z.string(),
    configured: z.boolean(),
    structuredProposals: z.boolean(),
    externalDataNotice: z.string(),
  })
  .strict();

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
