import { z } from 'zod';

export const MEMORY_CATEGORY_MAX_LENGTH = 80;
export const MEMORY_CONTENT_MAX_LENGTH = 2_000;
export const CHAT_MESSAGE_MAX_LENGTH = 8_000;

export const AGENT_TOOL_NAMES = [
  'weather.getForecast',
  'calendar.getEvents',
  'notes.search',
] as const;
export const agentToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;

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
    expiresAt: z.iso.datetime().nullable().default(null),
    archivedAt: z.iso.datetime().nullable().default(null),
  })
  .strict();

export type Memory = z.infer<typeof memorySchema>;

export const createMemoryInputSchema = z
  .object({
    category: z.string().trim().min(1).max(MEMORY_CATEGORY_MAX_LENGTH),
    content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX_LENGTH),
    priority: memoryPrioritySchema.default('normal'),
    expiresAt: z.iso.datetime().nullable().optional(),
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

export const automationTriggerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('interval'),
      intervalMinutes: z.number().int().min(15).max(10_080),
    })
    .strict(),
  z.object({ type: z.literal('memory.created') }).strict(),
  z.object({ type: z.literal('memory.updated') }).strict(),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const createAutomationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(2_000),
    trigger: automationTriggerSchema,
  })
  .strict();
export type CreateAutomationInput = z.input<typeof createAutomationInputSchema>;

export const automationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(80),
    prompt: z.string().min(1).max(2_000),
    trigger: automationTriggerSchema,
    status: z.enum(['active', 'paused']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    nextRunAt: z.iso.datetime().nullable(),
    lastRunAt: z.iso.datetime().nullable(),
  })
  .strict();
export type Automation = z.infer<typeof automationSchema>;

export const automationRunSchema = z
  .object({
    id: z.uuid(),
    automationId: z.uuid(),
    triggerType: z.enum(['interval', 'manual', 'memory.created', 'memory.updated']),
    scheduledFor: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    status: z.enum(['queued', 'running', 'succeeded', 'failed']),
    attempt: z.number().int().min(0).max(3),
    result: z.string().max(8_000).nullable(),
    error: z.string().max(300).nullable(),
  })
  .strict();
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationNotificationSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    automationId: z.uuid(),
    title: z.string().min(1).max(100),
    message: z.string().min(1).max(8_000),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .strict();
export type AutomationNotification = z.infer<typeof automationNotificationSchema>;

export const automationListResponseSchema = z
  .object({ items: z.array(automationSchema) })
  .strict();
export const automationRunListResponseSchema = z
  .object({ items: z.array(automationRunSchema) })
  .strict();
export const automationNotificationListResponseSchema = z
  .object({
    items: z.array(automationNotificationSchema),
    unread: z.number().int().nonnegative(),
  })
  .strict();
export const automationStatusInputSchema = z
  .object({ status: z.enum(['active', 'paused']) })
  .strict();

export const automationDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), message: z.string().min(1).max(8_000) }).strict(),
  z
    .object({
      kind: z.literal('tool_call'),
      name: agentToolNameSchema,
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

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
  z
    .object({
      kind: z.literal('tool_call'),
      name: agentToolNameSchema,
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
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
    toolsUsed: z.array(agentToolNameSchema).default([]),
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
    embeddingProvider: z.enum(['none', 'openai-compatible', 'ollama']),
    embeddingModel: z.string(),
    embeddingConfigured: z.boolean(),
    storageProvider: z.enum(['sqlite', 'json']),
    semanticSearch: z.boolean(),
    agentTools: z.array(
      z.object({ name: agentToolNameSchema, enabled: z.boolean() }).strict(),
    ),
  })
  .strict();

export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
