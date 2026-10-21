export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
}

export interface LlmResponse {
  content: string;
}

export interface LlmProvider {
  readonly name: 'openai-compatible' | 'ollama';
  chat(request: LlmRequest): Promise<LlmResponse>;
}
