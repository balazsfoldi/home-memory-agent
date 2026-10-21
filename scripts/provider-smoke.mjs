import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { loadConfig } from '../apps/api/dist/config.js';
import { hasConfiguredProvider } from '../apps/api/dist/config.js';
import { agentDecisionSchema } from '../packages/shared/dist/index.js';
import { OllamaProvider } from '../apps/api/dist/infrastructure/llm/ollama-provider.js';
import { OpenAiCompatibleProvider } from '../apps/api/dist/infrastructure/llm/openai-compatible-provider.js';

dotenv.config({ path: resolve(process.cwd(), '.env'), quiet: true });
const config = loadConfig();
if (!hasConfiguredProvider(config)) {
  console.error(
    'Set LLM_PROVIDER, LLM_BASE_URL, and LLM_MODEL in .env. OpenAI-compatible providers also need LLM_API_KEY.',
  );
  process.exitCode = 2;
} else {
  try {
    const provider =
      config.provider === 'ollama'
        ? new OllamaProvider(config)
        : new OpenAiCompatibleProvider(config);
    const response = await provider.chat({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            'Return only this exact JSON object: {"kind":"answer","message":"Home Memory Agent provider check passed."}.',
        },
        {
          role: 'user',
          content: 'Run a short provider smoke check using fictional data only.',
        },
      ],
    });
    const result = agentDecisionSchema.safeParse(JSON.parse(response.content));
    if (!result.success || result.data.kind !== 'answer')
      throw new Error('Invalid provider response.');
    console.info(`The ${provider.name} provider returned a valid, structured answer.`);
  } catch (error) {
    const kind =
      error && typeof error === 'object' && 'kind' in error && typeof error.kind === 'string'
        ? error.kind
        : 'request_failed';
    console.error(
      `Provider check failed (${kind}). Review the service and local .env settings.`,
    );
    process.exitCode = 1;
  }
}
