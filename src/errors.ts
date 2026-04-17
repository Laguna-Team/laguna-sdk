/**
 * Error hierarchy for the SDK. All errors thrown by client methods extend
 * `LagunaError` so consumers can catch them with a single `instanceof` check.
 */

export class LagunaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly responseBody?: unknown
  ) {
    super(message)
    this.name = 'LagunaError'
  }
}

export class LagunaAuthError extends LagunaError {
  constructor(message: string, status: number, responseBody?: unknown) {
    super(message, 'AUTH_ERROR', status, responseBody)
    this.name = 'LagunaAuthError'
  }
}

export class LagunaValidationError extends LagunaError {
  constructor(message: string, status: number, responseBody?: unknown) {
    super(message, 'VALIDATION_ERROR', status, responseBody)
    this.name = 'LagunaValidationError'
  }
}

export class LagunaScopeError extends LagunaError {
  constructor(message: string, status: number, responseBody?: unknown) {
    super(message, 'SCOPE_ERROR', status, responseBody)
    this.name = 'LagunaScopeError'
  }
}

export class LagunaRateLimitError extends LagunaError {
  constructor(message: string, status: number, readonly retryAfterSeconds?: number, responseBody?: unknown) {
    super(message, 'RATE_LIMIT', status, responseBody)
    this.name = 'LagunaRateLimitError'
  }
}

export class LagunaServerError extends LagunaError {
  constructor(message: string, status: number, responseBody?: unknown) {
    super(message, 'SERVER_ERROR', status, responseBody)
    this.name = 'LagunaServerError'
  }
}

export class LagunaNetworkError extends LagunaError {
  constructor(message: string, readonly cause: unknown) {
    super(message, 'NETWORK_ERROR')
    this.name = 'LagunaNetworkError'
  }
}

export class LagunaWebhookSignatureError extends LagunaError {
  constructor(message = 'Invalid or missing X-Laguna-Signature header') {
    super(message, 'INVALID_SIGNATURE')
    this.name = 'LagunaWebhookSignatureError'
  }
}
