import type { AppConfig } from '../../config.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../../domain/llm-provider.js';
import { LlmUpstreamError } from './http-error.js';
import { classifyFetchFailure, linkedTimeout, readSuccessfulJson } from './http-error.js';

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (!this.config.baseUrl || !this.config.apiKey || !request.model) {
      throw new Error('The OpenAI-compatible provider is not configured.');
    }
    const endpoint = /\/chat\/completions$/u.test(this.config.baseUrl)
      ? this.config.baseUrl
      : `${this.config.baseUrl}/chat/completions`;
    const signal = linkedTimeout(this.config.llmTimeoutMs, request.signal);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: request.model,
          stream: false,
          messages: request.messages,
          ...(this.config.openaiStructuredOutput
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      });
    } catch (error) {
      throw classifyFetchFailure(error, request.signal);
    }
    const body = await readSuccessfulJson(response);
    const choices = body.choices;
    if (!Array.isArray(choices) || !choices.length) {
      throw new LlmUpstreamError('response');
    }
    const first = choices[0];
    if (!first || typeof first !== 'object') throw new LlmUpstreamError('response');
    const message = (first as { message?: { content?: unknown } }).message;
    if (!message || typeof message.content !== 'string')
      throw new LlmUpstreamError('response');
    return { content: message.content };
  }
}
