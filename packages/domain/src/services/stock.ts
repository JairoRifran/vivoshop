import { DomainError } from '../errors';
import type { ProductVariant } from '../entities/catalog';
import { assertPositiveQuantity, type ProductId, type VariantId } from '../value-objects/identifiers';

/**
 * One unit of stock movement, as both persistence drivers understand it.
 *
 * Reservation is all-or-nothing: either every line is decremented or none is.
 * Defining the request and the outcome here — in the domain — is what keeps
 * the in-memory driver and PostgreSQL observably identical, instead of two
 * implementations that happen to look similar.
 */
export interface StockReservationLine {
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly quantity: number;
}

export interface StockShortfall {
  readonly productId: ProductId;
  readonly variantId: VariantId;
  readonly requested: number;
  /** Null when the variant no longer exists or is inactive. */
  readonly available: number | null;
}

export type StockReservationResult =
  | { readonly ok: true; readonly remaining: ReadonlyArray<{ variantId: VariantId; stock: number }> }
  | { readonly ok: false; readonly shortfall: StockShortfall };

/**
 * Deadlocks between two transactions that touch the same variants in opposite
 * orders are avoided by always locking in the same order. Sorting the lines is
 * the whole mechanism, and it has to happen in both drivers.
 */
export function orderReservationLines(
  lines: readonly StockReservationLine[],
): readonly StockReservationLine[] {
  return [...lines].sort((a, b) => (String(a.variantId) < String(b.variantId) ? -1 : 1));
}

/** Turns a failed reservation into the error the API and the UI understand. */
export function stockShortfallError(shortfall: StockShortfall): DomainError {
  return new DomainError(
    shortfall.available === null ? 'VARIANT_UNAVAILABLE' : 'OUT_OF_STOCK',
    shortfall.available === null
      ? 'That variant is no longer available'
      : 'Not enough units left',
    {
      productId: shortfall.productId,
      variantId: shortfall.variantId,
      requested: shortfall.requested,
      available: shortfall.available ?? 0,
    },
  );
}

export function isStockAvailable(
  variant: Pick<ProductVariant, 'stock' | 'active'>,
  quantity: number,
): boolean {
  return variant.active && variant.stock >= quantity;
}

export function assertStockAvailable(
  variant: Pick<ProductVariant, 'id' | 'stock' | 'active'>,
  quantity: number,
): void {
  assertPositiveQuantity(quantity);
  if (!variant.active) {
    throw new DomainError('OUT_OF_STOCK', 'Variant is not available', { variantId: variant.id });
  }
  if (variant.stock < quantity) {
    throw new DomainError('OUT_OF_STOCK', 'Not enough units left', {
      variantId: variant.id,
      requested: quantity,
      available: variant.stock,
    });
  }
}

/** Returns a new variant with stock reduced. Never mutates the input. */
export function reserveStock(variant: ProductVariant, quantity: number): ProductVariant {
  assertStockAvailable(variant, quantity);
  return { ...variant, stock: variant.stock - quantity };
}

/** Used when an order is cancelled. */
export function releaseStock(variant: ProductVariant, quantity: number): ProductVariant {
  assertPositiveQuantity(quantity);
  return { ...variant, stock: variant.stock + quantity };
}

/**
 * Urgency copy for the live viewer. Scarcity is real information here, not a
 * dark pattern: it is only shown when the number is genuinely small.
 */
export function stockUrgency(stock: number): 'none' | 'low' | 'last' | 'out' {
  if (stock <= 0) return 'out';
  if (stock === 1) return 'last';
  if (stock <= 5) return 'low';
  return 'none';
}
