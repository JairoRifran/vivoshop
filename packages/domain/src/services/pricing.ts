import type { CurrencyCode, TaxConfig, TaxRule } from '@vivo/config';
import { DomainError } from '../errors';
import type { Product, ProductVariant } from '../entities/catalog';
import { variantLabel, variantPrice } from '../entities/catalog';
import type { OrderItem } from '../entities/order';
import type { StoreSettings } from '../entities/store';
import { assertPositiveQuantity } from '../value-objects/identifiers';
import { money } from '../value-objects/money';
import { isInclusive, resolveTaxRule, summarizeTax, taxForAmount, type TaxSnapshot } from './tax';

/**
 * Snapshots a catalog product into an immutable order line, including the tax
 * rule it is charged under. Everything the buyer saw at purchase time — title,
 * variant, image, price and tax — is copied here on purpose.
 */
export function buildOrderItem(
  product: Product,
  variant: ProductVariant,
  quantity: number,
  tax: TaxConfig,
): OrderItem {
  assertPositiveQuantity(quantity);

  const unitPrice = variantPrice(product, variant);
  const subtotalMinor = unitPrice.amountMinor * quantity;
  const rule = resolveTaxRule(tax, product);
  const taxAmount = taxForAmount(money(subtotalMinor, product.currency), rule);

  return {
    productId: product.id,
    variantId: variant.id,
    titleSnapshot: product.title,
    variantLabelSnapshot: variantLabel(variant),
    imageUrlSnapshot: product.images[0]?.url ?? null,
    unitPriceMinor: unitPrice.amountMinor,
    quantity,
    subtotalMinor,
    taxCategory: rule.category,
    taxRateBps: rule.rateBps,
    taxAmountMinor: taxAmount.amountMinor,
  };
}

export interface OrderTotals {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency: CurrencyCode;
  readonly tax: TaxSnapshot;
}

export interface TotalsInput {
  readonly items: readonly OrderItem[];
  readonly currency: CurrencyCode;
  readonly shippingMinor: number;
  readonly discountMinor?: number;
  readonly tax: TaxConfig;
  /** Rule for the shipping fee itself. Defaults to the market's default rule. */
  readonly shippingTaxRule?: TaxRule;
}

/**
 * The single place order money is computed. The API uses it when creating an
 * order and the web checkout uses it to preview totals, so the number the
 * buyer sees can never drift from the number that gets charged.
 *
 * Tax is summed **per line** rather than applied to the grand total. For an
 * order where every line shares a rate the result is identical, but it means
 * an order mixing a standard-rate and an exempt product is correct today
 * rather than after a rewrite.
 */
export function calculateOrderTotals(input: TotalsInput): OrderTotals {
  const { items, currency, shippingMinor, tax } = input;
  const discountMinor = input.discountMinor ?? 0;

  if (items.length === 0) {
    throw new DomainError('EMPTY_ORDER', 'An order needs at least one item');
  }
  if (shippingMinor < 0 || discountMinor < 0) {
    throw new DomainError('INVALID_MONEY', 'Shipping and discount cannot be negative', {
      shippingMinor,
      discountMinor,
    });
  }

  const subtotalMinor = items.reduce((total, item) => total + item.subtotalMinor, 0);
  const cappedDiscount = Math.min(discountMinor, subtotalMinor);

  const shippingRule = input.shippingTaxRule ?? resolveTaxRule(tax);
  const shippingTax = taxForAmount(money(shippingMinor, currency), shippingRule);

  const parts = [
    ...items.map((item) => ({
      rule: ruleFromItem(item, tax),
      amountMinor: item.taxAmountMinor,
      baseMinor: item.subtotalMinor,
    })),
    ...(shippingMinor > 0
      ? [{ rule: shippingRule, amountMinor: shippingTax.amountMinor, baseMinor: shippingMinor }]
      : []),
  ];

  const snapshot = summarizeTax(parts);
  const netTotal = subtotalMinor - cappedDiscount + shippingMinor;

  // Inclusive markets already have the tax inside the quoted prices, so the
  // total is the sum of what was quoted. Additive markets put it on top.
  const totalMinor = isInclusive(snapshot) ? netTotal : netTotal + snapshot.amountMinor;

  return {
    subtotalMinor,
    shippingMinor,
    discountMinor: cappedDiscount,
    taxMinor: snapshot.amountMinor,
    totalMinor,
    currency,
    tax: snapshot,
  };
}

/** Rebuilds a line's rule from its snapshot, falling back to the market. */
function ruleFromItem(item: OrderItem, tax: TaxConfig): TaxRule {
  const known = tax.rules[item.taxCategory];
  if (known) return known;
  return {
    treatment: item.taxRateBps > 0 ? 'included' : 'exempt',
    rateBps: item.taxRateBps,
    label: 'Impuestos',
    category: item.taxCategory,
  };
}

/** Free shipping kicks in above the store threshold, when one is configured. */
export function resolveShippingFee(
  baseFeeMinor: number,
  subtotalMinor: number,
  settings: Pick<StoreSettings, 'freeShippingThresholdMinor'>,
): number {
  const threshold = settings.freeShippingThresholdMinor;
  if (threshold !== null && subtotalMinor >= threshold) return 0;
  return baseFeeMinor;
}

/**
 * Installment preview for the product sheet. Purely indicative until a real
 * PaymentProvider returns the issuer's plan.
 */
export function installmentPreview(
  totalMinor: number,
  installments: number,
): { installments: number; amountMinor: number } | null {
  if (installments < 2 || totalMinor <= 0) return null;
  return { installments, amountMinor: Math.ceil(totalMinor / installments) };
}
