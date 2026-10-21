import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env'), quiet: true });

const base = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/u, '');
const apiKey = process.env.LLM_API_KEY ?? '';
const model = process.env.LLM_MODEL ?? '';
const endpoint = /\/chat\/completions$/u.test(base) ? base : `${base}/chat/completions`;

if (!base || !apiKey || !model) {
  const missing = [
    !base && 'LLM_BASE_URL',
    !apiKey && 'LLM_API_KEY',
    !model && 'LLM_MODEL',
  ].filter(Boolean);
  console.error(`Hiányzó .env beállítás: ${missing.join(', ')}`);
  process.exitCode = 2;
} else {
  const body = {
    model,
    stream: false,
    messages: [
      {
        role: 'system',
        content:
          'Return only valid JSON with this shape: {"kind":"answer","message":"Provider check passed."}.',
      },
      { role: 'user', content: 'Reply using JSON only.' },
    ],
    ...(process.env.OPENAI_STRUCTURED_OUTPUT === 'true'
      ? { response_format: { type: 'json_object' } }
      : {}),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    console.info(
      JSON.stringify({
        httpStatus: response.status,
        errorCode: data.error?.code ?? null,
        errorType: data.error?.type ?? null,
        errorMessage:
          typeof data.error?.message === 'string' ? data.error.message.slice(0, 300) : null,
      }),
    );
  } catch (error) {
    console.info(
      JSON.stringify({
        networkError: error?.cause?.code ?? error?.name ?? 'unknown',
      }),
    );
  }
}
