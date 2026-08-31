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
  | 'STREAMING_UNAVAILABLE'
  // --- Payments and trust (M03) -----------------------------------------
  /** The payment cannot move to that status from where it is. */
  | 'INVALID_PAYMENT_TRANSITION'
  /** The seller has not connected an account able to receive money. */
  | 'SELLER_PAYMENT_ACCOUNT_MISSING'
  /** The connected account exists but cannot be used right now. */
  | 'SELLER_PAYMENT_ACCOUNT_INVALID'
  /** The payment provider refused or is unreachable. */
  | 'PAYMENT_UNAVAILABLE'
  /** The OAuth callback did not carry a state we issued, or it expired. */
  | 'INVALID_OAUTH_STATE'
  /** The verification cannot move to that status from where it is. */
  | 'INVALID_VERIFICATION_TRANSITION'
  /** The submitted commercial details are incomplete. */
  | 'VERIFICATION_DETAILS_INCOMPLETE'
  /** The protection cannot move to that status from where it is. */
  | 'INVALID_PROTECTION_TRANSITION'
  // --- Modo Puja (M04) ---------------------------------------------------
  /** The bid session cannot move to that status from where it is. */
  | 'INVALID_BID_SESSION_TRANSITION'
  /** The session is not taking offers: closed, reserved, sold or expired. */
  | 'BID_SESSION_NOT_OPEN'
  /** Below the minimum bid or below the minimum increment. */
  | 'BID_TOO_LOW'
  /** Not a positive integer, or out of the safe range. */
  | 'INVALID_BID_AMOUNT'
  /** The offer belongs to a different session. */
  | 'BID_NOT_IN_SESSION'
  /** The offer was already accepted, expired, or otherwise cannot be used. */
  | 'BID_NOT_ACTIVE'
  /** A seller cannot bid on their own session. */
  | 'CANNOT_BID_ON_OWN_STORE'
  /** The winner's window to pay has passed. */
  | 'BID_RESERVATION_EXPIRED'
  /** The product already has a bid session open in this live. */
  | 'BID_SESSION_ALREADY_OPEN'
  // --- Imagenes de perfil y tienda (M06) --------------------------------
  /**
   * La clave de imagen no tiene la forma que emitimos, o es de otro dueno.
   *
   * Un solo codigo para ambos casos a proposito: distinguirlos le diria a quien
   * prueba claves ajenas cuales existen.
   */
  | 'INVALID_MEDIA_KEY'
  /** El almacenamiento de imagenes refuso la operacion o esta inalcanzable. */
  | 'STORAGE_UNAVAILABLE'
  // --- Ingreso con Google / Meta (M07) ----------------------------------
  /** El proveedor no compartio un email, y sin email no hay a quien vincular. */
  | 'IDENTITY_EMAIL_REQUIRED'
  /** El proveedor de identidad refuso o esta inalcanzable. */
  | 'IDENTITY_UNAVAILABLE'
  /** Ese proveedor no esta habilitado en esta instalacion. */
  | 'IDENTITY_PROVIDER_DISABLED';

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
