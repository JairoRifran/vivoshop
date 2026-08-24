import type { CountryCode, CurrencyCode, DeliveryKind } from '@vivo/config';
import { DomainError } from '../errors';
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

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
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
];

export function timelineIndex(status: OrderStatus): number {
  return ORDER_TIMELINE.indexOf(status);
}

// --- Payment ----------------------------------------------------------------

export const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

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
export interface OrderItem {
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly titleSnapshot: string;
  readonly variantLabelSnapshot: string;
  readonly imageUrlSnapshot: string | null;
  readonly unitPriceMinor: number;
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
