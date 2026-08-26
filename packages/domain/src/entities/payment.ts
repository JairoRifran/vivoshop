import { DomainError } from '../errors';
import type { CurrencyCode } from '@vivo/config';
import type { OrderId, PaymentId, StoreId, UserId } from '../value-objects/identifiers';

/**
 * Un pago, sin saber quién lo procesa.
 *
 * Nada de acá menciona a Mercado Pago. El proveedor vive detrás de
 * `PaymentProvider` y traduce en los dos sentidos; si mañana entra dLocal, lo
 * único que cambia es el adaptador. La regla que hace posible eso es simple y
 * conviene decirla en voz alta: **ningún estado, campo o nombre de este
 * archivo puede venir del vocabulario de un proveedor**.
 */

/**
 * Para qué se cobra.
 *
 * Hoy solo existe la compra de un pedido, pero el sistema de pagos no puede
 * suponer que todo pago es una compra: cobrar por promocionar un vivo usa el
 * mismo circuito —intent, webhook, estado, reembolso— y sería absurdo montar
 * un segundo. El propósito viaja desde el principio para que agregarlo después
 * no obligue a migrar los pagos que ya existan.
 */
export const PAYMENT_PURPOSES = ['order', 'live_promotion'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/**
 * Estados de un pago.
 *
 * Deliberadamente distintos de los del pedido. Un pedido creado **no** es un
 * pago aprobado, y confundirlos es la forma más rápida de mostrarle "venta
 * confirmada" a un vendedor por algo que todavía no cobró.
 *
 * `expired` existe aparte de `cancelled` porque no significan lo mismo para el
 * stock ni para el comprador: cancelado es una decisión, vencido es que se
 * acabó el tiempo.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Transiciones legales.
 *
 * `pending` es el único estado del que se sale hacia cualquier lado, porque es
 * el único donde el proveedor todavía está decidiendo. `approved` solo puede ir
 * a `refunded`: un pago aprobado no se "cancela", se devuelve, y esa distinción
 * es la que mantiene la contabilidad honesta.
 */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled', 'expired'],
  approved: ['refunded'],
  rejected: [],
  cancelled: [],
  expired: [],
  refunded: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new DomainError('INVALID_PAYMENT_TRANSITION', 'Payment cannot change to that status', {
      from,
      to,
    });
  }
}

/**
 * Cuánto vive una reserva de stock mientras nadie paga.
 *
 * Media hora: bastante para pagar con calma —buscar la tarjeta, cambiar de
 * dispositivo, volver del banco— y poco para que un carrito abandonado deje un
 * producto trabado. En un vivo, donde el stock es escaso y la demanda dura lo
 * que dura la transmisión, retener una unidad de más es perder una venta que
 * estaba ahí.
 *
 * Vive acá y en `CHECKOUT_RESERVATION_TTL_SECONDS`, y en ningún otro lado.
 */
export const DEFAULT_CHECKOUT_RESERVATION_SECONDS = 30 * 60;

/**
 * Hasta cuándo se le guarda el stock a un pago sin resolver.
 *
 * **Manda el proveedor cuando opina.** Si la preferencia trae fecha de
 * vencimiento, esa gana: es la que conoce el comprador —es la que ve en la
 * pantalla de pago— y liberar antes sería quitarle el producto a alguien que
 * todavía está en tiempo de pagarlo. El TTL local es el respaldo para cuando el
 * proveedor no dice nada, que es el caso de Checkout Pro sin expiración.
 */
export function checkoutReservationDeadline(
  payment: { readonly createdAt: Date; readonly expiresAt: Date | null },
  ttlSeconds: number,
): Date {
  return payment.expiresAt ?? new Date(payment.createdAt.getTime() + ttlSeconds * 1_000);
}

/**
 * Si la reserva ya se venció.
 *
 * Solo un pago `pending` tiene reserva que vencer: los demás ya resolvieron —
 * `approved` la consumió, `rejected`, `cancelled` y `expired` la devolvieron—.
 * Preguntar por uno resuelto siempre da `false`, y esa es la primera de las dos
 * defensas contra liberar dos veces. La segunda es la máquina de estados, que
 * solo deja salir de `pending` una vez.
 */
export function isCheckoutReservationLapsed(
  payment: {
    readonly status: PaymentStatus;
    readonly createdAt: Date;
    readonly expiresAt: Date | null;
  },
  now: Date,
  ttlSeconds: number,
): boolean {
  if (payment.status !== 'pending') return false;
  return checkoutReservationDeadline(payment, ttlSeconds).getTime() <= now.getTime();
}

/** Un pago que ya no va a cambiar por su cuenta. */
export function isPaymentSettled(status: PaymentStatus): boolean {
  return status !== 'pending';
}

/**
 * Estados en los que el stock reservado **debe volver a la góndola**.
 *
 * Es la lista que evita el peor error de este milestone: dejar unidades
 * bloqueadas porque alguien abrió el checkout y cerró la pestaña.
 */
export const STOCK_RELEASING_STATUSES: readonly PaymentStatus[] = [
  'rejected',
  'cancelled',
  'expired',
];

export function releasesStock(status: PaymentStatus): boolean {
  return STOCK_RELEASING_STATUSES.includes(status);
}

/**
 * Cómo se repartió el dinero.
 *
 * Se guarda congelado en el pago, no se recalcula al leer: la política de
 * comisión puede cambiar mañana y lo que se cobró ayer tiene que seguir
 * diciendo lo que se cobró ayer.
 */
export interface PaymentSplit {
  /** Lo que paga el comprador. */
  readonly grossMinor: number;
  /** Lo que se queda VivoShop. */
  readonly commissionMinor: number;
  /** Puntos básicos aplicados, para poder auditar sin adivinar. */
  readonly commissionRateBps: number;
  /** Nombre de la política que produjo esa tasa, p. ej. `standard`. */
  readonly commissionPolicy: string;
  /** Lo que le queda al vendedor antes de las comisiones del proveedor. */
  readonly netMinor: number;
}

export interface Payment {
  readonly id: PaymentId;
  readonly purpose: PaymentPurpose;
  /** Presente cuando `purpose` es `order`. Null para cobros que no son compras. */
  readonly orderId: OrderId | null;
  /** Quién cobra. Para `live_promotion` es la tienda que promociona. */
  readonly storeId: StoreId;
  readonly payerId: UserId;
  readonly status: PaymentStatus;
  readonly currency: CurrencyCode;
  readonly split: PaymentSplit;
  readonly installments: number;
  /** Clave del `PaymentProvider` que lo procesa, p. ej. `mercadopago`. */
  readonly provider: string;
  /**
   * Identificador del proveedor para la intención de cobro — en Checkout Pro,
   * la preferencia. Existe antes de que el comprador pague.
   */
  readonly providerIntentId: string | null;
  /**
   * Identificador del proveedor para el pago concreto. Aparece recién cuando
   * alguien paga de verdad, y es el que se consulta para saber la verdad.
   */
  readonly providerPaymentId: string | null;
  /** A dónde se manda al comprador para pagar. */
  readonly checkoutUrl: string | null;
  /**
   * Motivo del rechazo tal como lo dio el proveedor, para soporte. Nunca se
   * muestra crudo: la UI traduce por código.
   */
  readonly failureReason: string | null;
  readonly expiresAt: Date | null;
  readonly approvedAt: Date | null;
  readonly refundedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Qué estado le corresponde al pedido según el pago.
 *
 * Una sola función para que no haya dos lugares decidiendo lo mismo. Devuelve
 * `null` cuando el pago no obliga a mover el pedido.
 */
export function orderStatusForPayment(status: PaymentStatus): 'paid' | 'cancelled' | null {
  if (status === 'approved') return 'paid';
  if (status === 'rejected' || status === 'cancelled' || status === 'expired') return 'cancelled';
  // Un reembolso no cancela el pedido: la mercadería pudo haberse entregado.
  // Qué pasa después es una decisión del vendedor, no una consecuencia mecánica.
  return null;
}
