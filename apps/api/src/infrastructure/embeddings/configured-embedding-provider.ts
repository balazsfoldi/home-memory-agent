import { createHash } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { EmbeddingProvider } from '../../domain/embedding-provider.js';
import { LlmUpstreamError } from '../llm/http-error.js';
import { classifyFetchFailure, linkedTimeout, readSuccessfulJson } from '../llm/http-error.js';

function vectors(value: unknown): number[][] {
  if (!Array.isArray(value) || !value.length) throw new LlmUpstreamError('response');
  return value.map((entry) => {
    if (
      !Array.isArray(entry) ||
      !entry.length ||
      !entry.every((component) => typeof component === 'number' && Number.isFinite(component))
    )
      throw new LlmUpstreamError('response');
    return entry as number[];
  });
}

export class ConfiguredEmbeddingProvider implements EmbeddingProvider {
  readonly identity: string;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const endpointHash = createHash('sha256').update(config.embeddingBaseUrl).digest('hex');
    this.identity = `${config.embeddingProvider}:${config.embeddingModel}:${endpointHash}`;
  }

  async embed(input: string[]): Promise<number[][]> {
    if (
      this.config.embeddingProvider === 'none' ||
      !this.config.embeddingBaseUrl ||
      !this.config.embeddingModel ||
      (this.config.embeddingProvider === 'openai-compatible' && !this.config.embeddingApiKey)
    )
      throw new Error('The embedding provider is not configured.');
    if (!input.length || input.length > 64 || input.some((text) => text.length > 4_200))
      throw new LlmUpstreamError('response');

    const ollama = this.config.embeddingProvider === 'ollama';
    const base = this.config.embeddingBaseUrl;
    const endpoint = ollama
      ? base.endsWith('/api')
        ? `${base}/embed`
        : `${base}/api/embed`
      : /\/embeddings$/u.test(base)
        ? base
        : `${base}/embeddings`;
    const signal = linkedTimeout(this.config.embeddingTimeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(!ollama ? { authorization: `Bearer ${this.config.embeddingApiKey}` } : {}),
        },
        signal,
        body: JSON.stringify(
          ollama
            ? { model: this.config.embeddingModel, input }
            : { model: this.config.embeddingModel, input },
        ),
      });
    } catch (error) {
      throw classifyFetchFailure(error);
    }

    const body = await readSuccessfulJson(response, 4_000_000);
    if (ollama) return vectors(body.embeddings);
    const data = body.data;
    if (!Array.isArray(data)) throw new LlmUpstreamError('response');
    const ordered = [...data].sort((left, right) => {
      const a = left as { index?: number };
      const b = right as { index?: number };
      return (a.index ?? 0) - (b.index ?? 0);
    });
    return vectors(ordered.map((entry) => (entry as { embedding?: unknown }).embedding));
  }
}
