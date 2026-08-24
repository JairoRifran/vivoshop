import type { DeliveryMethodConfig, PaymentMethodConfig, TaxConfig } from '@vivo/config';
import type { Product, ProductVariant } from '../entities/catalog';
import { assertPurchasable, findVariant } from '../entities/catalog';
import type { Address, OrderDelivery, OrderItem, OrderPayment } from '../entities/order';
import { assertDeliveryAddress } from '../entities/order';
import type { Store } from '../entities/store';
import { assertStoreCanSell } from '../entities/store';
import { assertStockAvailable } from './stock';
import { buildOrderItem, calculateOrderTotals, resolveShippingFee, type OrderTotals } from './pricing';
import type { VariantId } from '../value-objects/identifiers';

export interface CheckoutLineRequest {
  readonly product: Product;
  readonly variantId: VariantId;
  readonly quantity: number;
}

export interface CheckoutRequest {
  readonly store: Store;
  readonly lines: readonly CheckoutLineRequest[];
  readonly deliveryMethod: DeliveryMethodConfig;
  readonly paymentMethod: PaymentMethodConfig;
  readonly installments: number;
  readonly address: Address | null;
  readonly tax: TaxConfig;
  /**
   * Price previews run before the buyer has filled in an address, so they opt
   * out of the address requirement. Order creation never does.
   */
  readonly enforceAddress?: boolean;
  /**
   * Skips the read-based stock check. Order creation sets this because the
   * authority is the atomic conditional decrement inside the transaction, not
   * a value read a moment earlier.
   */
  readonly skipStockCheck?: boolean;
}

export interface CheckoutReservation {
  readonly product: Product;
  readonly variant: ProductVariant;
  readonly quantity: number;
}

export interface CheckoutDraft {
  readonly items: readonly OrderItem[];
  readonly totals: OrderTotals;
  readonly delivery: OrderDelivery;
  readonly payment: OrderPayment;
  readonly reservations: readonly CheckoutReservation[];
}

/**
 * Validates and prices a purchase without touching any storage. The API layer
 * calls this, then persists; the web checkout calls the API's preview endpoint
 * which calls this too, so both sides compute the same numbers from the same
 * code path.
 *
 * What this function is *not* is the guardian of stock. It can check a value
 * it was handed, which produces a fast and friendly error, but between that
 * read and the write another buyer may have taken the last unit. The only
 * authority is the conditional decrement in `reserveStock`, inside the
 * transaction. See `docs/architecture.md`.
 *
 * M01 scope: a draft belongs to exactly one store. Multi-store carts are a
 * deliberate non-goal, and this signature makes that constraint explicit.
 */
export function buildCheckoutDraft(request: CheckoutRequest): CheckoutDraft {
  const { store, lines, deliveryMethod, paymentMethod, address, tax } = request;

  assertStoreCanSell(store);

  const reservations = lines.map((line) => {
    assertPurchasable(line.product);
    const variant = findVariant(line.product, line.variantId);
    if (request.skipStockCheck !== true) assertStockAvailable(variant, line.quantity);
    return { product: line.product, variant, quantity: line.quantity };
  });

  const items = reservations.map((reservation) =>
    buildOrderItem(reservation.product, reservation.variant, reservation.quantity, tax),
  );

  const subtotalMinor = items.reduce((total, item) => total + item.subtotalMinor, 0);
  const shippingMinor = resolveShippingFee(
    deliveryMethod.flatFeeMinor,
    subtotalMinor,
    store.settings,
  );

  const totals = calculateOrderTotals({
    items,
    currency: store.currency,
    shippingMinor,
    tax,
  });

  const delivery: OrderDelivery = {
    methodId: deliveryMethod.id,
    kind: deliveryMethod.kind,
    label: deliveryMethod.label,
    estimate: deliveryMethod.estimate,
    address: deliveryMethod.requiresAddress ? address : null,
    trackingCode: null,
  };
  if (request.enforceAddress !== false) assertDeliveryAddress(delivery);

  const payment: OrderPayment = {
    methodId: paymentMethod.id,
    provider: paymentMethod.provider,
    status: 'pending',
    installments: paymentMethod.supportsInstallments
      ? Math.min(Math.max(1, request.installments), paymentMethod.maxInstallments)
      : 1,
    reference: null,
    paidAt: null,
  };

  return { items, totals, delivery, payment, reservations };
}
