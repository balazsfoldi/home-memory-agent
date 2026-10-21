import type { AppConfig } from '../../config.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../../domain/llm-provider.js';
import { LlmUpstreamError } from './http-error.js';
import { classifyFetchFailure, linkedTimeout, readSuccessfulJson } from './http-error.js';

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (!this.config.baseUrl || !request.model) throw new Error('Ollama is not configured.');
    const endpoint = this.config.baseUrl.endsWith('/api')
      ? `${this.config.baseUrl}/chat`
      : `${this.config.baseUrl}/api/chat`;
    const signal = linkedTimeout(this.config.llmTimeoutMs, request.signal);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: request.model,
          stream: false,
          format: 'json',
          messages: request.messages,
        }),
      });
    } catch (error) {
      throw classifyFetchFailure(error, request.signal);
    }
    const body = await readSuccessfulJson(response);
    const message = body.message;
    if (!message || typeof message !== 'object') throw new LlmUpstreamError('response');
    const content = (message as { content?: unknown }).content;
    if (typeof content !== 'string') throw new LlmUpstreamError('response');
    return { content };
  }
}
