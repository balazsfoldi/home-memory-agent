import { z } from 'zod';
import { agentToolNameSchema, type AgentToolName } from '@home-memory/shared';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATA_PATH: z.string().trim().min(1).default('./data'),
  MEMORY_STORE: z.enum(['sqlite', 'json']).default('sqlite'),
  LLM_PROVIDER: z.enum(['none', 'openai-compatible', 'ollama']).default('none'),
  LLM_BASE_URL: z.string().trim().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().trim().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  EMBEDDING_PROVIDER: z.enum(['none', 'openai-compatible', 'ollama']).default('none'),
  EMBEDDING_BASE_URL: z.string().trim().default(''),
  EMBEDDING_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().trim().default(''),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  AGENT_TOOLS: z.string().default(''),
  OPENAI_STRUCTURED_OUTPUT: booleanString,
});

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  dataPath: string;
  storeProvider: 'sqlite' | 'json';
  provider: 'none' | 'openai-compatible' | 'ollama';
  baseUrl: string;
  apiKey: string;
  model: string;
  llmTimeoutMs: number;
  embeddingProvider: 'none' | 'openai-compatible' | 'ollama';
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingTimeoutMs: number;
  agentTools: AgentToolName[];
  openaiStructuredOutput: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const invalidNames = parsed.error.issues
      .map((issue) => String(issue.path[0] ?? 'configuration'))
      .filter((name, index, names) => names.indexOf(name) === index);
    throw new Error(`Invalid server configuration in: ${invalidNames.join(', ')}`);
  }
  const value = parsed.data;
  const configuredTools = value.AGENT_TOOLS.trim()
    ? value.AGENT_TOOLS.split(',').map((name) => name.trim())
    : [];
  const toolNames = z.array(agentToolNameSchema).safeParse(configuredTools);
  if (!toolNames.success || new Set(configuredTools).size !== configuredTools.length) {
    throw new Error('Invalid server configuration in: AGENT_TOOLS');
  }
  const parseBaseUrl = (name: string, input: string): string => {
    if (!input) return '';
    try {
      const url = new URL(input);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error('invalid url');
      }
      return url.toString().replace(/\/+$/u, '');
    } catch {
      throw new Error(`${name} must be an HTTP or HTTPS URL without embedded credentials.`);
    }
  };
  const baseUrl = parseBaseUrl('LLM_BASE_URL', value.LLM_BASE_URL);
  const embeddingBaseUrl = parseBaseUrl(
    'EMBEDDING_BASE_URL',
    value.EMBEDDING_BASE_URL || value.LLM_BASE_URL,
  );
  return {
    host: value.HOST,
    port: value.PORT,
    nodeEnv: value.NODE_ENV,
    dataPath: resolve(projectRoot, value.DATA_PATH),
    storeProvider: value.MEMORY_STORE,
    provider: value.LLM_PROVIDER,
    baseUrl,
    apiKey: value.LLM_API_KEY,
    model: value.LLM_MODEL,
    llmTimeoutMs: value.LLM_TIMEOUT_MS,
    embeddingProvider: value.EMBEDDING_PROVIDER,
    embeddingBaseUrl,
    embeddingApiKey: value.EMBEDDING_API_KEY || value.LLM_API_KEY,
    embeddingModel: value.EMBEDDING_MODEL,
    embeddingTimeoutMs: value.EMBEDDING_TIMEOUT_MS,
    agentTools: toolNames.data,
    openaiStructuredOutput: value.OPENAI_STRUCTURED_OUTPUT,
  };
}

export function hasConfiguredEmbeddingProvider(config: AppConfig): boolean {
  if (
    !config.embeddingModel ||
    config.embeddingProvider === 'none' ||
    !config.embeddingBaseUrl
  )
    return false;
  return config.embeddingProvider !== 'openai-compatible' || Boolean(config.embeddingApiKey);
}

export function hasConfiguredProvider(config: AppConfig): boolean {
  if (!config.model || config.provider === 'none' || !config.baseUrl) return false;
  return config.provider !== 'openai-compatible' || Boolean(config.apiKey);
}
