import { DomainError } from '../errors';
import type { OrderId, UserId } from '../value-objects/identifiers';

/**
 * Compra Protegida: los ejes que **no** son el estado del pago.
 *
 * ## La regla que ordena todo este archivo
 *
 * ```
 * pago aprobado  ≠  el vendedor tiene la plata disponible
 * ```
 *
 * Son dos hechos distintos y tratarlos como uno es el error que después se
 * paga caro: se le dice al comprador "tu dinero está protegido" cuando en
 * realidad ya se liquidó, o se le dice al vendedor "cobraste" cuando el dinero
 * todavía no se puede retirar. Por eso hay cuatro ejes y no uno:
 *
 * ```
 * PaymentStatus       ¿el pago se aprobó?          -> entities/payment.ts
 * OrderStatus         ¿en qué anda el pedido?      -> entities/order.ts
 * ProtectionStatus    ¿la compra está protegida?   -> acá
 * SettlementStatus    ¿la plata se liberó?         -> acá
 * ```
 *
 * `OrderStatus` cumple el papel de estado de cumplimiento: ya existía, ya está
 * probado y la UI depende de él, así que se adapta en vez de duplicarse — dos
 * enums que quieren decir lo mismo se separan a la primera de cambio.
 *
 * ## Lo que VivoShop no hace
 *
 * No custodia fondos. No hay wallet, no hay escrow propio, no hay una cuenta
 * de VivoShop donde se junte plata ajena. La retención, si existe, la hace el
 * proveedor de pagos; si el proveedor no la soporta, la promesa **no se
 * muestra**. Prometer protección sin mecanismo real es peor que no ofrecerla.
 */

// --- Protección --------------------------------------------------------------

export const PROTECTION_STATUSES = [
  /** El proveedor no puede retener, o la compra no califica. */
  'not_applicable',
  /** Califica, pero todavía no hay pago aprobado. */
  'eligible',
  /** Hay pago aprobado y la liberación está sujeta a la entrega. */
  'protected',
  /** El comprador abrió un reclamo. */
  'disputed',
  /** El reclamo terminó, a favor de quien sea. */
  'resolved',
] as const;
export type ProtectionStatus = (typeof PROTECTION_STATUSES)[number];

// --- Liquidación -------------------------------------------------------------

export const SETTLEMENT_STATUSES = [
  /** El proveedor liquida cuando quiere; VivoShop no controla el momento. */
  'not_supported',
  /** Retenido, esperando que se cumpla la condición de liberación. */
  'pending_release',
  /** El vendedor ya dispone del dinero. */
  'released',
  /** Congelado por un reclamo o por una decisión de riesgo. */
  'held',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * Qué sabe hacer el proveedor.
 *
 * Cada `PaymentProvider` declara únicamente lo que soporta de verdad, y la UI
 * decide qué prometer mirando esto. Es el interruptor que impide mostrar
 * "retenemos tu dinero hasta la entrega" cuando el proveedor liquida al
 * instante.
 *
 * El futuro `DLocalProvider` puede declarar un conjunto distinto sin que
 * `Order`, `Payment` ni el checkout se enteren.
 */
export interface PaymentCapabilities {
  /** Puede demorar la liquidación al vendedor. Sin esto no hay protección real. */
  readonly supportsDelayedSettlement: boolean;
  /** Se le puede pedir que libere ahora. */
  readonly supportsManualRelease: boolean;
  /** Tiene un circuito de reclamos propio. */
  readonly supportsDisputes: boolean;
  readonly supportsRefunds: boolean;
}

export const NO_PAYMENT_CAPABILITIES: PaymentCapabilities = {
  supportsDelayedSettlement: false,
  supportsManualRelease: false,
  supportsDisputes: false,
  supportsRefunds: false,
};

/**
 * Cuánto se puede prometer, que no es sí o no.
 *
 * Retener el dinero, poder devolverlo y poder resolver un reclamo son tres
 * capacidades distintas, y la Compra Protegida las necesita a las tres:
 * retener sin poder devolver deja la plata trabada sin salida, y devolver sin
 * un circuito de reclamos deja al comprador sin forma de pedirlo. Prometer el
 * escudo con una sola de las tres sería vender algo que no existe.
 *
 * Por eso la respuesta es un nivel y no un booleano: la UI dice exactamente lo
 * que el proveedor puede garantizar, ni más ni menos.
 */
export const PROTECTION_LEVELS = ['none', 'refund_only', 'full'] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];

export function protectionLevel(capabilities: PaymentCapabilities): ProtectionLevel {
  if (
    capabilities.supportsDelayedSettlement &&
    capabilities.supportsRefunds &&
    capabilities.supportsDisputes
  ) {
    return 'full';
  }
  // Sin retención no hay nada retenido, pero si se puede devolver el dinero
  // hay algo honesto que decir: "si algo sale mal, te lo devolvemos".
  if (capabilities.supportsRefunds) return 'refund_only';
  return 'none';
}

/**
 * Si se le puede mostrar el escudo 🛡️ y la promesa fuerte al comprador.
 *
 * Solo con el nivel completo. Un proveedor que únicamente reembolsa **no**
 * habilita "tu dinero queda retenido hasta que recibas el producto": eso sería
 * describir un mecanismo que no está ocurriendo.
 */
export function canPromiseProtection(capabilities: PaymentCapabilities): boolean {
  return protectionLevel(capabilities) === 'full';
}

/**
 * Con qué estado nace la protección de una compra.
 *
 * `eligible` solo si la protección es completa, porque `ProtectionStatus`
 * describe un ciclo —protegida, reclamada, resuelta— que sin retención ni
 * reclamos no tiene dónde ocurrir. Con `refund_only` el reembolso sigue
 * disponible; simplemente no es este eje el que lo representa.
 */
export function initialProtection(capabilities: PaymentCapabilities): ProtectionStatus {
  return canPromiseProtection(capabilities) ? 'eligible' : 'not_applicable';
}

export function initialSettlement(capabilities: PaymentCapabilities): SettlementStatus {
  return capabilities.supportsDelayedSettlement ? 'pending_release' : 'not_supported';
}

// --- Reclamos ----------------------------------------------------------------

export const DISPUTE_REASONS = [
  'not_received',
  'wrong_item',
  'damaged',
  'not_as_described',
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const DISPUTE_STATUSES = ['open', 'resolved_buyer', 'resolved_seller', 'withdrawn'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Un reclamo del comprador.
 *
 * Declarado, no mediado. M03 deja el estado y los eventos; el circuito completo
 * —evidencia, plazos de respuesta, decisión— es trabajo posterior. Lo que sí
 * queda resuelto ahora es que un reclamo pueda congelar una liquidación, que es
 * lo único que sería imposible agregar después sin migrar pagos.
 */
export interface Dispute {
  readonly orderId: OrderId;
  readonly openedBy: UserId;
  readonly reason: DisputeReason;
  readonly status: DisputeStatus;
  readonly detail: string;
  readonly openedAt: Date;
  readonly resolvedAt: Date | null;
}

// --- Plazos de cumplimiento ---------------------------------------------------

/**
 * Los relojes del ciclo ideal.
 *
 * ```
 * comprador paga -> aprobado -> el vendedor despacha -> enviado
 *   -> entregado -> el comprador confirma -> completado -> (se pide liberar)
 *
 * El último paso está entre paréntesis a propósito: completar pide la
 * liberación, no la efectúa. Quien libera es el proveedor.
 * ```
 *
 * Con dos salidas para cuando nadie hace nada, porque en la vida real pasa:
 *
 *  - **El comprador no confirma.** El sistema no puede depender del botón
 *    "Recibí mi compra". Con entrega confirmada por seguimiento, corre un
 *    período de seguridad y, sin reclamo, se completa solo.
 *  - **El vendedor no despacha.** Tiene un plazo; después un recordatorio; si
 *    igual no despacha, se cancela y se devuelve el dinero, y el incumplimiento
 *    queda registrado.
 *
 * Los valores son marcadores razonables, no una decisión de producto cerrada:
 * están acá para que el ciclo se pueda razonar y probar, y se ajustan cuando
 * haya datos reales.
 */
export const FULFILLMENT_DEADLINES = {
  /** Desde el pago aprobado hasta que el vendedor tiene que despachar. */
  shipBySeconds: 3 * 24 * 3600,
  /** Cuándo avisarle que se le vence el plazo. */
  shipReminderSeconds: 2 * 24 * 3600,
  /** Desde la entrega confirmada hasta que se completa sola. */
  autoCompleteSeconds: 7 * 24 * 3600,
} as const;

export type FulfillmentBreach = 'none' | 'shipping_overdue';

export function shippingBreach(
  order: { readonly paidAt: Date | null; readonly shippedAt: Date | null },
  now: Date = new Date(),
  deadlines = FULFILLMENT_DEADLINES,
): FulfillmentBreach {
  if (!order.paidAt || order.shippedAt) return 'none';
  const elapsed = (now.getTime() - order.paidAt.getTime()) / 1000;
  return elapsed >= deadlines.shipBySeconds ? 'shipping_overdue' : 'none';
}

export function shouldRemindToShip(
  order: { readonly paidAt: Date | null; readonly shippedAt: Date | null },
  now: Date = new Date(),
  deadlines = FULFILLMENT_DEADLINES,
): boolean {
  if (!order.paidAt || order.shippedAt) return false;
  const elapsed = (now.getTime() - order.paidAt.getTime()) / 1000;
  return elapsed >= deadlines.shipReminderSeconds && elapsed < deadlines.shipBySeconds;
}

/** Sin reclamo y pasado el período de seguridad, la compra se completa sola. */
export function canAutoComplete(
  order: {
    readonly deliveredAt: Date | null;
    readonly protection: ProtectionStatus;
  },
  now: Date = new Date(),
  deadlines = FULFILLMENT_DEADLINES,
): boolean {
  if (!order.deliveredAt || order.protection === 'disputed') return false;
  return (now.getTime() - order.deliveredAt.getTime()) / 1000 >= deadlines.autoCompleteSeconds;
}

/**
 * Si corresponde pedirle al proveedor que libere.
 *
 * Es la única relación entre los dos ejes, y es deliberadamente débil:
 * completar el pedido **habilita** el intento, no lo consuma. La liberación la
 * hace el proveedor y puede demorar, fallar o quedar congelada por un reclamo;
 * hasta que confirme, `SettlementStatus` sigue en `pending_release` aunque el
 * pedido esté `completed`.
 */
export function shouldAttemptRelease(input: {
  readonly orderStatus: string;
  readonly settlement: SettlementStatus;
  readonly protection: ProtectionStatus;
}): boolean {
  if (input.settlement !== 'pending_release') return false;
  if (input.protection === 'disputed') return false;
  return input.orderStatus === 'completed';
}

// --- Stock -------------------------------------------------------------------

/**
 * Si hay que devolver las unidades a la góndola.
 *
 * Depende de **dos** cosas, y ahí está la corrección que importa: devolver el
 * dinero y devolver el producto no son lo mismo. Un pago rechazado antes de
 * despachar libera stock; un reembolso después del envío **no**, porque la
 * mercadería salió y reponerla inventaría unidades que no están en el depósito.
 */
export function shouldReleaseStock(input: {
  readonly paymentStatus: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'refunded';
  readonly shippedAt: Date | null;
}): boolean {
  if (input.shippedAt) return false;
  return (
    input.paymentStatus === 'rejected' ||
    input.paymentStatus === 'cancelled' ||
    input.paymentStatus === 'expired'
  );
}

// --- Transiciones de protección ------------------------------------------------

const PROTECTION_TRANSITIONS: Record<ProtectionStatus, readonly ProtectionStatus[]> = {
  not_applicable: [],
  eligible: ['protected', 'not_applicable'],
  protected: ['disputed', 'resolved'],
  disputed: ['resolved'],
  resolved: [],
};

export function canTransitionProtection(from: ProtectionStatus, to: ProtectionStatus): boolean {
  return PROTECTION_TRANSITIONS[from].includes(to);
}

export function assertProtectionTransition(from: ProtectionStatus, to: ProtectionStatus): void {
  if (!canTransitionProtection(from, to)) {
    throw new DomainError('INVALID_PROTECTION_TRANSITION', 'Protection cannot change to that', {
      from,
      to,
    });
  }
}
