import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { AppConfig } from '../../src/config.js';
import { OpenAiCompatibleProvider } from '../../src/infrastructure/llm/openai-compatible-provider.js';
import { OllamaProvider } from '../../src/infrastructure/llm/ollama-provider.js';
import { LlmUpstreamError } from '../../src/infrastructure/llm/http-error.js';
import { ConfiguredEmbeddingProvider } from '../../src/infrastructure/embeddings/configured-embedding-provider.js';

function configured(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    nodeEnv: 'test',
    dataPath: './data',
    storeProvider: 'sqlite',
    provider: 'openai-compatible',
    baseUrl: 'https://llm.example/v1',
    apiKey: 'private-test-key',
    model: 'fixture',
    llmTimeoutMs: 1_000,
    embeddingProvider: 'none',
    embeddingBaseUrl: '',
    embeddingApiKey: '',
    embeddingModel: '',
    embeddingTimeoutMs: 1_000,
    agentTools: [],
    openaiStructuredOutput: true,
    ...overrides,
  };
}

describe('LLM provider adapters', () => {
  it('validates operation-level agent tool permissions from configuration', () => {
    expect(loadConfig({ AGENT_TOOLS: 'notes.search, calendar.getEvents' }).agentTools).toEqual(
      ['notes.search', 'calendar.getEvents'],
    );
    expect(() => loadConfig({ AGENT_TOOLS: 'notes.search,unknown.write' })).toThrow(
      'AGENT_TOOLS',
    );
    expect(() => loadConfig({ AGENT_TOOLS: 'notes.search,notes.search' })).toThrow(
      'AGENT_TOOLS',
    );
  });

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

  it('defaults to a local SQLite store and validates the embedding endpoint', () => {
    const config = loadConfig({
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'nomic-embed-text',
      LLM_BASE_URL: 'http://ollama:11434',
    });
    expect(config.storeProvider).toBe('sqlite');
    expect(config.embeddingBaseUrl).toBe('http://ollama:11434');
    expect(() =>
      loadConfig({
        EMBEDDING_BASE_URL: 'file:///tmp/data',
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'nomic-embed-text',
      }),
    ).toThrow(/EMBEDDING_BASE_URL/u);
  });
});

describe('embedding provider adapter', () => {
  it('parses OpenAI-compatible vectors in input order', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new ConfiguredEmbeddingProvider(
      configured({
        embeddingProvider: 'openai-compatible',
        embeddingBaseUrl: 'https://embed.example/v1',
        embeddingApiKey: 'embedding-test-key',
        embeddingModel: 'fixture-embedding',
      }),
      fetcher,
    );

    await expect(provider.embed(['first', 'second'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://embed.example/v1/embeddings');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer embedding-test-key',
    );
  });

  it('uses Ollama /api/embed without an authorization header', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ embeddings: [[0.5, 0.5]] }), { status: 200 }),
      );
    const provider = new ConfiguredEmbeddingProvider(
      configured({
        embeddingProvider: 'ollama',
        embeddingBaseUrl: 'http://ollama:11434',
        embeddingModel: 'nomic-embed-text',
      }),
      fetcher,
    );

    await expect(provider.embed(['a memory'])).resolves.toEqual([[0.5, 0.5]]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://ollama:11434/api/embed');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
  });
});
