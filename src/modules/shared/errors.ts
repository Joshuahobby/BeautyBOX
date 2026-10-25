// Domain errors carry the contract's Error.code vocabulary. Route handlers map them
// to HTTP; messages are controlled application copy, never provider text.

export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STOCK_CHANGED: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_INVALID: 409,
  OUTSIDE_COVERAGE: 422,
  PAYMENT_UNRESOLVED: 409,
  PROVIDER_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  ACTION_NOT_ALLOWED: 409,
  REFUND_LIMIT: 409,
  PUBLICATION_BLOCKED: 409,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;
export type FieldError = { field: string; message: string };

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldError[];
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: FieldError[]; httpStatus?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.httpStatus = options.httpStatus ?? ERROR_HTTP_STATUS[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const notFound = () => new DomainError("NOT_FOUND", "This item is unavailable.");

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
