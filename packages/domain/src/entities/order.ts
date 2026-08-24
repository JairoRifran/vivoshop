import type { CountryCode, CurrencyCode, DeliveryKind } from '@vivo/config';
import { DomainError } from '../errors';
import type { PaymentStatus } from './payment';
import type { TaxSnapshot } from '../services/tax';
import type {
  AddressId,
  LiveSessionId,
  OrderId,
  ProductId,
  StoreId,
  UserId,
  VariantId,
} from '../value-objects/identifiers';

/**
 * El ciclo del pedido, que hace también de estado de cumplimiento.
 *
 * `completed` es nuevo en M03 y significa **una sola cosa**: la operación
 * comercial terminó bien. Llegó, el comprador lo dio por recibido y nadie
 * reclamó. `delivered` dice que llegó; `completed` dice que se cerró.
 *
 * No dice nada sobre la plata. Que el dinero esté liberado es
 * `SettlementStatus`, un eje aparte, y la combinación
 *
 *     OrderStatus = completed  +  SettlementStatus = pending_release
 *
 * es perfectamente válida: el pedido se cerró y el proveedor todavía no
 * liberó. Completar **puede disparar** un intento de liberación; no es la
 * liberación.
 */
export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function nextOrderStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new DomainError('INVALID_ORDER_TRANSITION', 'Order cannot change to that status', {
      from,
      to,
    });
  }
}

export function isOrderFinal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Ordered stages for the buyer-facing timeline. Cancelled is rendered apart. */
export const ORDER_TIMELINE: readonly OrderStatus[] = [
  'pending_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
];

export function timelineIndex(status: OrderStatus): number {
  return ORDER_TIMELINE.indexOf(status);
}

// --- Payment ----------------------------------------------------------------

/**
 * El estado del pago visto desde el pedido.
 *
 * Es el mismo vocabulario que usa la entidad `Payment`, importado y no
 * redefinido: dos listas de estados que quieren decir lo mismo se separan a la
 * primera de cambio, y el día que se separen alguien va a ver "pagado" en una
 * pantalla y "pendiente" en la otra.
 */
export type { PaymentStatus } from './payment';
export { PAYMENT_STATUSES } from './payment';

export interface OrderPayment {
  /** Market-config payment method id, e.g. `uy-mercadopago`. */
  readonly methodId: string;
  /** PaymentProvider key the infrastructure layer resolves, e.g. `mercadopago`. */
  readonly provider: string;
  readonly status: PaymentStatus;
  readonly installments: number;
  /** Provider transaction id. Null while payments are simulated. */
  readonly reference: string | null;
  readonly paidAt: Date | null;
}

// --- Delivery ---------------------------------------------------------------

export interface Address {
  readonly id: AddressId | null;
  readonly recipientName: string;
  readonly phone: string;
  readonly country: CountryCode;
  /** Region code from the market config, e.g. `MO` for Montevideo. */
  readonly regionCode: string;
  readonly regionName: string;
  readonly locality: string;
  readonly street: string;
  readonly postalCode: string | null;
  readonly notes: string | null;
}

export interface OrderDelivery {
  /** Market-config delivery method id, e.g. `uy-home-delivery`. */
  readonly methodId: string;
  readonly kind: DeliveryKind;
  readonly label: string;
  readonly estimate: string;
  /** Required for `shipping`, absent for pickup and seller coordination. */
  readonly address: Address | null;
  /** Populated by a ShippingProvider later. */
  readonly trackingCode: string | null;
}

// --- Order ------------------------------------------------------------------

/**
 * Line snapshots. An order must render identically in five years even if the
 * product is renamed, repriced or deleted, so titles, images and prices are
 * copied at purchase time rather than joined at read time.
 */
/**
 * Cómo se fijó el precio de una línea.
 *
 * `accepted_bid` todavía no lo produce nadie: queda declarado para que M04
 * —oferta aceptada, precio final, reserva, mismo checkout— no tenga que migrar
 * pedidos existentes ni agregar una columna a una tabla con datos.
 */
export const PRICE_SOURCES = ['catalog', 'accepted_bid'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface OrderItem {
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly titleSnapshot: string;
  readonly variantLabelSnapshot: string;
  readonly imageUrlSnapshot: string | null;
  readonly unitPriceMinor: number;
  /**
   * De dónde salió `unitPriceMinor`.
   *
   * Hoy siempre es el catálogo. Existe ahora porque el precio final de una
   * línea no siempre va a serlo: cuando entre el modo puja, una oferta
   * aceptada va a producir un precio que no está en ninguna ficha. Guardar el
   * origen desde el principio evita tener que adivinar después por qué un
   * pedido viejo tiene un número que no coincide con el catálogo.
   */
  readonly priceSource: PriceSource;
  readonly quantity: number;
  readonly subtotalMinor: number;
  /**
   * The tax rule this line was charged under, frozen at purchase time. Stored
   * per line so an order that mixes rates stays auditable, and so a future
   * rate change never rewrites history.
   */
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly taxAmountMinor: number;
}

export interface OrderEvent {
  readonly status: OrderStatus;
  readonly at: Date;
  readonly note: string | null;
}

export interface Order {
  readonly id: OrderId;
  /** Short human reference shown to buyer and seller, e.g. `VV-8F3K2`. */
  readonly code: string;
  readonly buyerId: UserId;
  readonly storeId: StoreId;
  /** Set when the purchase happened inside a live session. Drives attribution. */
  readonly liveSessionId: LiveSessionId | null;
  readonly items: readonly OrderItem[];
  readonly currency: CurrencyCode;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  /**
   * Total tax. Kept alongside `tax` because every read path wants the number,
   * and `tax` carries the rule that produced it.
   */
  readonly taxMinor: number;
  /** Snapshot of the tax treatment applied to this order. */
  readonly tax: TaxSnapshot;
  readonly status: OrderStatus;
  readonly payment: OrderPayment;
  readonly delivery: OrderDelivery;
  readonly buyerNote: string | null;
  readonly timeline: readonly OrderEvent[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function orderUnitCount(order: Pick<Order, 'items'>): number {
  return order.items.reduce((total, item) => total + item.quantity, 0);
}

export function isOrderPayable(order: Pick<Order, 'status'>): boolean {
  return order.status === 'pending_payment';
}

export function isOrderCancellableByBuyer(order: Pick<Order, 'status'>): boolean {
  return order.status === 'pending_payment' || order.status === 'paid';
}

export function assertDeliveryAddress(delivery: Pick<OrderDelivery, 'kind' | 'address'>): void {
  if (delivery.kind === 'shipping' && !delivery.address) {
    throw new DomainError('ADDRESS_REQUIRED', 'Shipping requires a delivery address', {
      kind: delivery.kind,
    });
  }
}
