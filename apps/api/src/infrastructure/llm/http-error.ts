export class LlmUpstreamError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'timeout' | 'auth' | 'response' | 'aborted',
    options?: ErrorOptions,
  ) {
    super('The configured language model provider could not complete the request.', options);
    this.name = 'LlmUpstreamError';
  }
}

export function linkedTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export function classifyFetchFailure(
  error: unknown,
  requestSignal?: AbortSignal,
): LlmUpstreamError {
  if (requestSignal?.aborted) return new LlmUpstreamError('aborted', { cause: error });
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new LlmUpstreamError('timeout', { cause: error });
  }
  return new LlmUpstreamError('unavailable', { cause: error });
}

export async function readSuccessfulJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? 'auth' : 'unavailable';
    throw new LlmUpstreamError(kind);
  }
  try {
    if (!response.body) throw new Error('missing response body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > 1_000_000) {
        await reader.cancel();
        throw new Error('response body exceeds the maximum allowed size');
      }
      chunks.push(part.value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('invalid body');
    return body as Record<string, unknown>;
  } catch (error) {
    throw new LlmUpstreamError('response', { cause: error });
  }
}
