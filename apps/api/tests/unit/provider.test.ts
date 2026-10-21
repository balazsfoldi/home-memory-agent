import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { AppConfig } from '../../src/config.js';
import { OpenAiCompatibleProvider } from '../../src/infrastructure/llm/openai-compatible-provider.js';
import { OllamaProvider } from '../../src/infrastructure/llm/ollama-provider.js';
import { LlmUpstreamError } from '../../src/infrastructure/llm/http-error.js';

function configured(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    nodeEnv: 'test',
    dataPath: './data',
    provider: 'openai-compatible',
    baseUrl: 'https://llm.example/v1',
    apiKey: 'private-test-key',
    model: 'fixture',
    llmTimeoutMs: 1_000,
    openaiStructuredOutput: true,
    ...overrides,
  };
}

describe('LLM provider adapters', () => {
  it('sends a structured, non-streaming OpenAI-compatible request and maps the response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"kind":"answer","message":"Hello"}' } }],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAiCompatibleProvider(configured(), fetcher);
    await expect(
      provider.chat({ model: 'fixture', messages: [{ role: 'user', content: 'Hi' }] }),
    ).resolves.toEqual({ content: '{"kind":"answer","message":"Hello"}' });
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe('https://llm.example/v1/chat/completions');
    const init = request?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-test-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: false,
      response_format: { type: 'json_object' },
    });
  });

  it('uses the native Ollama chat endpoint with JSON output and no credential header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: { role: 'assistant', content: '{"kind":"answer","message":"Szia"}' },
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaProvider(
      configured({ provider: 'ollama', baseUrl: 'http://ollama:11434' }),
      fetcher,
    );
    await expect(
      provider.chat({ model: 'fixture', messages: [{ role: 'user', content: 'Szia' }] }),
    ).resolves.toHaveProperty('content', '{"kind":"answer","message":"Szia"}');
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://ollama:11434/api/chat');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      format: 'json',
      stream: false,
    });
  });

  it('converts bad provider responses to a redacted error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('the api secret leaked here', { status: 401 }));
    const provider = new OpenAiCompatibleProvider(configured(), fetcher);
    await expect(
      provider.chat({ model: 'fixture', messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toBeInstanceOf(LlmUpstreamError);
    await expect(
      provider.chat({ model: 'fixture', messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.not.toThrow(/secret leaked/u);
  });

  it('validates the endpoint without including secrets in an error', () => {
    expect(() =>
      loadConfig({ LLM_BASE_URL: 'file:///etc/passwd', LLM_API_KEY: 'super-secret' }),
    ).toThrow(/LLM_BASE_URL/u);
    expect(() => loadConfig({ PORT: '70000', LLM_API_KEY: 'super-secret' })).toThrow(/PORT/u);
  });
});
