/**
 * Every failure crossing the network uses this envelope. Clients switch on
 * `code`; `message` is a Spanish sentence safe to show a buyer; `details` is
 * for developers and field-level form errors.
 */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly fieldErrors: Record<string, string[]>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? {};
    this.fieldErrors = body.fieldErrors ?? {};
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Network failure or a server that never answered. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Buyer-facing copy per error code. Anything unmapped falls back to a neutral
 * sentence, so a new server code can never leak English internals into the UI.
 */
const MESSAGES: Record<string, string> = {
  OUT_OF_STOCK: 'Se agotaron las unidades disponibles.',
  PRODUCT_UNAVAILABLE: 'Ese producto ya no está disponible.',
  VARIANT_UNAVAILABLE: 'Esa opción ya no está disponible.',
  IDEMPOTENCY_CONFLICT: 'Ya procesamos un pedido distinto con esa referencia.',
  INVALID_IDEMPOTENCY_KEY: 'La referencia del pedido no es válida.',
  ORDER_CREATION_FAILED: 'No pudimos completar el pedido. No se cobró nada.',
  PRODUCT_NOT_PURCHASABLE: 'Este producto ya no está a la venta.',
  VARIANT_NOT_FOUND: 'Esa variante ya no está disponible.',
  STORE_NOT_ACTIVE: 'La tienda no está recibiendo pedidos en este momento.',
  ADDRESS_REQUIRED: 'Necesitamos una dirección para el envío.',
  INVALID_ORDER_TRANSITION: 'El pedido ya no admite ese cambio de estado.',
  INVALID_LIVE_TRANSITION: 'La transmisión ya no admite ese cambio.',
  EMAIL_TAKEN: 'Ya existe una cuenta con ese email.',
  INVALID_CREDENTIALS: 'Email o contraseña incorrectos.',
  SLUG_TAKEN: 'Ese nombre de tienda ya está en uso.',
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
  UNAUTHORIZED: 'Iniciá sesión para continuar.',
  FORBIDDEN: 'No tenés permiso para hacer esto.',
  NOT_FOUND: 'No encontramos lo que buscabas.',
  RATE_LIMITED: 'Demasiados intentos. Esperá un momento.',
  LIVE_NOT_JOINABLE: 'Esta transmisión no está disponible en este momento.',
  NOT_BROADCASTER: 'Solo quien transmite puede hacer esto.',
  STREAMING_UNAVAILABLE: 'No pudimos conectar el video. Intentá de nuevo en unos segundos.',
  NETWORK_ERROR: 'No pudimos conectarnos. Revisá tu conexión.',
};

export function humanizeError(error: unknown): string {
  if (isApiError(error)) {
    return MESSAGES[error.code] ?? error.message ?? 'Algo salió mal. Intentá de nuevo.';
  }
  return 'Algo salió mal. Intentá de nuevo.';
}
