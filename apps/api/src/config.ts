import { z } from 'zod';
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
  LLM_PROVIDER: z.enum(['none', 'openai-compatible', 'ollama']).default('none'),
  LLM_BASE_URL: z.string().trim().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().trim().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  OPENAI_STRUCTURED_OUTPUT: booleanString,
});

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  dataPath: string;
  provider: 'none' | 'openai-compatible' | 'ollama';
  baseUrl: string;
  apiKey: string;
  model: string;
  llmTimeoutMs: number;
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
  let baseUrl = '';
  if (value.LLM_BASE_URL) {
    try {
      const url = new URL(value.LLM_BASE_URL);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error('invalid url');
      }
      baseUrl = url.toString().replace(/\/+$/u, '');
    } catch {
      throw new Error(
        'LLM_BASE_URL must be an HTTP or HTTPS URL without embedded credentials.',
      );
    }
  }
  return {
    host: value.HOST,
    port: value.PORT,
    nodeEnv: value.NODE_ENV,
    dataPath: resolve(projectRoot, value.DATA_PATH),
    provider: value.LLM_PROVIDER,
    baseUrl,
    apiKey: value.LLM_API_KEY,
    model: value.LLM_MODEL,
    llmTimeoutMs: value.LLM_TIMEOUT_MS,
    openaiStructuredOutput: value.OPENAI_STRUCTURED_OUTPUT,
  };
}

export function hasConfiguredProvider(config: AppConfig): boolean {
  if (!config.model || config.provider === 'none' || !config.baseUrl) return false;
  return config.provider !== 'openai-compatible' || Boolean(config.apiKey);
}
