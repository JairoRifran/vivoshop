/**
 * Domain errors carry a stable machine-readable `code`. Transport layers map
 * the code to an HTTP status; clients map it to a human message. The `message`
 * here is for logs and developers, never rendered verbatim to a buyer.
 */
export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_SLUG'
  | 'INVALID_EMAIL'
  | 'INVALID_QUANTITY'
  | 'OUT_OF_STOCK'
  | 'VARIANT_NOT_FOUND'
  | 'PRODUCT_NOT_PURCHASABLE'
  | 'EMPTY_ORDER'
  | 'INVALID_ORDER_TRANSITION'
  | 'INVALID_LIVE_TRANSITION'
  | 'LIVE_PRODUCT_NOT_ATTACHED'
  | 'STORE_NOT_ACTIVE'
  | 'NOT_STORE_OWNER'
  | 'ADDRESS_REQUIRED'
  // --- Commerce hardening (M01.1) ---------------------------------------
  /** The product exists but cannot be sold right now. */
  | 'PRODUCT_UNAVAILABLE'
  /** The variant is gone, deactivated, or does not belong to the product. */
  | 'VARIANT_UNAVAILABLE'
  /** Same idempotency key replayed with a materially different payload. */
  | 'IDEMPOTENCY_CONFLICT'
  /** The idempotency key is malformed. */
  | 'INVALID_IDEMPOTENCY_KEY'
  /** The transaction rolled back. Nothing was written, nothing was reserved. */
  | 'ORDER_CREATION_FAILED'
  // --- Live infrastructure (M02) ----------------------------------------
  /** Too many chat messages from one identity in too little time. */
  | 'RATE_LIMITED'
  /** The session is not in a state that allows this participant to connect. */
  | 'LIVE_NOT_JOINABLE'
  /** The caller may not broadcast into this session. */
  | 'NOT_BROADCASTER'
  /** The streaming provider refused or is unreachable. */
  | 'STREAMING_UNAVAILABLE';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
