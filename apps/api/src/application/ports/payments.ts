import type { CurrencyCode } from '@vivo/config';
import type {
  Dispute,
  OAuthState,
  Order,
  OrderId,
  Payment,
  PaymentCapabilities,
  PaymentId,
  PaymentPurpose,
  PaymentStatus,
  SellerPaymentAccount,
  StoreId,
  UserId,
} from '@vivo/domain';

/**
 * La costura de cobros.
 *
 * `MercadoPagoProvider` la implementa hoy; `DLocalProvider` la va a implementar
 * mañana sin que `Order`, `Checkout`, `CommissionPolicy`, `Payment` ni
 * `SellerPaymentAccount` se enteren. La regla que lo hace posible: **nada de
 * este archivo usa vocabulario de un proveedor**. Ni `preference`, ni
 * `collector`, ni `marketplace_fee`. El adaptador traduce en los dos sentidos.
 */

/** Lo que el proveedor necesita saber para armar un cobro. */
export interface CheckoutRequest {
  readonly paymentId: PaymentId;
  readonly purpose: PaymentPurpose;
  readonly description: string;
  readonly currency: CurrencyCode;
  /** Lo que paga el comprador, en unidades menores. */
  readonly grossMinor: number;
  /**
   * Lo que retiene VivoShop, ya calculado por `CommissionPolicy`.
   *
   * Llega resuelto a propósito: el proveedor cobra lo que se le dice, no
   * decide cuánto. Poner el 3% acá adentro obligaría a repetirlo en cada
   * adaptador y a tocarlos todos para una promoción.
   */
  readonly commissionMinor: number;
  readonly installments: number;
  /** Cuenta del vendedor que recibe el dinero. Modelo marketplace. */
  readonly sellerAccount: SellerPaymentAccount;
  readonly payer: { readonly email: string; readonly name: string };
  /** A dónde vuelve el comprador. El redirect **no** decide si se aprobó. */
  readonly returnUrls: {
    readonly success: string;
    readonly failure: string;
    readonly pending: string;
  };
  /** Referencia propia que el proveedor devuelve en el webhook. */
  readonly externalReference: string;
}

export interface CheckoutSession {
  /** Identificador de la intención en el proveedor. */
  readonly intentId: string;
  /** A dónde mandar al comprador. */
  readonly checkoutUrl: string;
  readonly expiresAt: Date | null;
}

/** Lo que el proveedor dice que pasó de verdad, consultado por nosotros. */
export interface ProviderPayment {
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly externalReference: string | null;
  readonly amountMinor: number;
  readonly installments: number;
  /** Motivo crudo del rechazo, para soporte. Nunca se muestra tal cual. */
  readonly failureReason: string | null;
  readonly approvedAt: Date | null;
}

/**
 * Un aviso del proveedor, ya normalizado.
 *
 * `eventId` es la clave de idempotencia: el mismo aviso repetido tiene el mismo
 * id, y eso es lo que impide descontar stock dos veces.
 */
export interface WebhookNotification {
  readonly eventId: string;
  readonly providerPaymentId: string;
}

export interface RefundRequest {
  readonly payment: Payment;
  readonly sellerAccount: SellerPaymentAccount;
  /** Parcial cuando viene; total cuando es null. */
  readonly amountMinor: number | null;
}

// --- OAuth del vendedor -------------------------------------------------------

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly externalAccountId: string;
  readonly externalAccountLabel: string | null;
}

/**
 * El proveedor de cobros.
 *
 * Un solo puerto y no tres porque las tres cosas —conectar la cuenta, cobrar y
 * devolver— las hace el mismo sistema con las mismas credenciales. Partirlo
 * obligaría a mantener tres registros de la misma configuración.
 */
export interface PaymentProviderPort {
  readonly key: string;

  /** Lo que sabe hacer. La UI promete exactamente esto y nada más. */
  capabilities(): PaymentCapabilities;

  // --- Conexión de la cuenta del vendedor ---
  /** A dónde mandar al vendedor para que autorice. `state` va anti-CSRF. */
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;

  // --- Cobro ---
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** La verdad autoritativa. Se consulta; no se cree lo que llega en el aviso. */
  getPayment(input: {
    providerPaymentId: string;
    sellerAccount: SellerPaymentAccount;
  }): Promise<ProviderPayment>;
  /** Normaliza el cuerpo del webhook y valida su origen. */
  parseWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): WebhookNotification | null;

  refund(request: RefundRequest): Promise<void>;
  /** Solo si `supportsManualRelease`. Pide liberar lo retenido. */
  releaseSettlement?(input: {
    payment: Payment;
    sellerAccount: SellerPaymentAccount;
  }): Promise<void>;
}

// --- Repositorios --------------------------------------------------------------

export interface PaymentRepository {
  create(payment: Payment): Promise<Payment>;
  update(payment: Payment): Promise<Payment>;
  findById(id: PaymentId): Promise<Payment | null>;
  findByOrderId(orderId: OrderId): Promise<Payment | null>;
  findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<Payment | null>;
  /** Los que siguen en `pending` y ya vencieron. Los barre una tarea. */
  listExpired(now: Date): Promise<Payment[]>;
}

/**
 * El registro de avisos ya procesados.
 *
 * `claim` devuelve `false` cuando el aviso ya se había visto. Es un insert con
 * clave única, no un "leer y después escribir": dos webhooks simultáneos del
 * mismo pago tienen que poder competir sin que ganen los dos.
 */
export interface WebhookEventRepository {
  claim(input: { provider: string; eventId: string; paymentId: PaymentId | null }): Promise<boolean>;
}

export interface SellerPaymentAccountRepository {
  find(storeId: StoreId, provider: string): Promise<SellerPaymentAccount | null>;
  save(account: SellerPaymentAccount): Promise<SellerPaymentAccount>;
  remove(storeId: StoreId, provider: string): Promise<void>;
}

export interface OAuthStateRepository {
  create(state: OAuthState): Promise<void>;
  /** Lo consume: devolverlo dos veces es lo que este método impide. */
  consume(state: string, now: Date): Promise<OAuthState | null>;
}

export interface DisputeRepository {
  create(dispute: Dispute): Promise<Dispute>;
  update(dispute: Dispute): Promise<Dispute>;
  findByOrderId(orderId: OrderId): Promise<Dispute | null>;
}

/**
 * Lo que el webhook necesita hacer en una sola transacción.
 *
 * Aprobar un pago mueve tres cosas —el pago, el pedido y el stock— y las tres
 * tienen que quedar consistentes o ninguna. Es el mismo patrón que M01.1 usó
 * para la creación del pedido, por el mismo motivo.
 */
export interface PaymentTransaction {
  loadPayment(id: PaymentId): Promise<Payment | null>;
  savePayment(payment: Payment): Promise<Payment>;
  loadOrder(id: OrderId): Promise<Order | null>;
  saveOrder(order: Order): Promise<Order>;
  /** Devuelve las unidades reservadas. Idempotente por diseño del llamador. */
  releaseStock(order: Order): Promise<void>;
}

export interface PaymentTransactionRunner {
  run<T>(work: (tx: PaymentTransaction) => Promise<T>): Promise<T>;
}

// --- Tokens de inyección --------------------------------------------------------

export const PAYMENT_PROVIDER_PORT = Symbol('PaymentProviderPort');
export const PAYMENT_REPOSITORY = Symbol('PaymentRepository');
export const WEBHOOK_EVENT_REPOSITORY = Symbol('WebhookEventRepository');
export const SELLER_PAYMENT_ACCOUNT_REPOSITORY = Symbol('SellerPaymentAccountRepository');
export const OAUTH_STATE_REPOSITORY = Symbol('OAuthStateRepository');
export const DISPUTE_REPOSITORY = Symbol('DisputeRepository');
export const PAYMENT_TRANSACTION_RUNNER = Symbol('PaymentTransactionRunner');

/** Reexportado para que los servicios no tengan que importar de dos lados. */
export type { UserId };
