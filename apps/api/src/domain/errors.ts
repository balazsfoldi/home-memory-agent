export type ApplicationErrorCode =
  | 'INVALID_INPUT'
  | 'MEMORY_NOT_FOUND'
  | 'AUTOMATION_NOT_FOUND'
  | 'AUTOMATION_ACTIVE_RUN'
  | 'MEMORY_ALREADY_EXISTS'
  | 'PRECONDITION_REQUIRED'
  | 'STALE_MEMORY'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_BUSY'
  | 'CHAT_UNAVAILABLE'
  | 'CHAT_EXPIRED'
  | 'CHAT_ALREADY_RUNNING'
  | 'CHAT_CONTEXT_CHANGED'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_AUTH_FAILED'
  | 'BODY_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string | number | boolean>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationError';
  }
}

export class InstanceAlreadyRunningError extends Error {
  constructor() {
    super('The data directory is already in use by another Home Memory Agent instance.');
    this.name = 'InstanceAlreadyRunningError';
  }
}

export class StoreCorruptError extends Error {
  constructor(message = 'The memories file is invalid or has an unsupported format.') {
    super(message);
    this.name = 'StoreCorruptError';
  }
}

export const notFoundError = (): ApplicationError =>
  new ApplicationError('MEMORY_NOT_FOUND', 'A memória nem található.', 404);
