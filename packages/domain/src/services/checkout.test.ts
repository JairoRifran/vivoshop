import { getMarket } from '@vivo/config';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { makeProduct, makeStore, makeVariant } from '../testing/fixtures';
import { asVariantId } from '../value-objects/identifiers';
import { buildCheckoutDraft } from './checkout';
import { buildOrderCode } from './order-code';
import { calculateOrderTotals, buildOrderItem, installmentPreview, resolveShippingFee } from './pricing';
import { releaseStock, reserveStock, stockUrgency } from './stock';

const market = getMarket('UY');
const shipping = market.delivery.find((method) => method.kind === 'shipping')!;
const pickup = market.delivery.find((method) => method.kind === 'pickup')!;
const mercadoPago = market.payment[0]!;

describe('pricing', () => {
  it('snapshots the product into an order line', () => {
    const product = makeProduct();
    const item = buildOrderItem(product, product.variants[0]!, 2, market.tax);
    expect(item.titleSnapshot).toBe('Campera Roma');
    expect(item.variantLabelSnapshot).toBe('Negro · M');
    expect(item.unitPriceMinor).toBe(249000);
    expect(item.subtotalMinor).toBe(498000);
  });

  it('prefers the variant price over the product base price', () => {
    const product = makeProduct({ variants: [makeVariant({ priceMinor: 199000 })] });
    expect(buildOrderItem(product, product.variants[0]!, 1, market.tax).unitPriceMinor).toBe(199000);
  });

  it('rejects an empty order', () => {
    expect(() =>
      calculateOrderTotals({ items: [], currency: 'UYU', shippingMinor: 0, tax: market.tax }),
    ).toThrow(DomainError);
  });

  it('extracts IVA from the gross total instead of adding it', () => {
    const product = makeProduct();
    const items = [buildOrderItem(product, product.variants[0]!, 1, market.tax)];
    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: 19000,
      tax: market.tax,
    });

    expect(totals.subtotalMinor).toBe(249000);
    expect(totals.totalMinor).toBe(268000);
    // Tax is inside the total, so it must never inflate what the buyer pays.
    expect(totals.taxMinor).toBeLessThan(totals.totalMinor);
    expect(totals.taxMinor).toBe(48328);
  });

  it('caps a discount at the subtotal', () => {
    const product = makeProduct();
    const items = [buildOrderItem(product, product.variants[0]!, 1, market.tax)];
    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: 0,
      discountMinor: 999999,
      tax: market.tax,
    });
    expect(totals.discountMinor).toBe(249000);
    expect(totals.totalMinor).toBe(0);
  });

  it('applies the store free-shipping threshold', () => {
    expect(resolveShippingFee(19000, 500000, { freeShippingThresholdMinor: 300000 })).toBe(0);
    expect(resolveShippingFee(19000, 100000, { freeShippingThresholdMinor: 300000 })).toBe(19000);
    expect(resolveShippingFee(19000, 999999, { freeShippingThresholdMinor: null })).toBe(19000);
  });

  it('previews installments only when they make sense', () => {
    expect(installmentPreview(120000, 6)).toEqual({ installments: 6, amountMinor: 20000 });
    expect(installmentPreview(120000, 1)).toBeNull();
  });
});

describe('stock', () => {
  it('reserves and releases without mutating the variant', () => {
    const variant = makeVariant({ stock: 3 });
    const reserved = reserveStock(variant, 2);
    expect(variant.stock).toBe(3);
    expect(reserved.stock).toBe(1);
    expect(releaseStock(reserved, 2).stock).toBe(3);
  });

  it('refuses to oversell', () => {
    expect(() => reserveStock(makeVariant({ stock: 1 }), 2)).toThrow(DomainError);
    expect(() => reserveStock(makeVariant({ active: false }), 1)).toThrow(DomainError);
  });

  it('classifies urgency for the live viewer', () => {
    expect(stockUrgency(0)).toBe('out');
    expect(stockUrgency(1)).toBe('last');
    expect(stockUrgency(4)).toBe('low');
    expect(stockUrgency(40)).toBe('none');
  });
});

describe('checkout draft', () => {
  const base = {
    store: makeStore(),
    lines: [{ product: makeProduct(), variantId: asVariantId('variant-1'), quantity: 1 }],
    deliveryMethod: shipping,
    paymentMethod: mercadoPago,
    installments: 6,
    address: {
      id: null,
      recipientName: 'Ana Pérez',
      phone: '+59899123456',
      country: 'UY' as const,
      regionCode: 'MO',
      regionName: 'Montevideo',
      locality: 'Pocitos',
      street: 'Av. Brasil 2550 apto 401',
      postalCode: null,
      notes: 'Portero eléctrico 401',
    },
    tax: market.tax,
  };

  it('prices a shipped purchase end to end', () => {
    const draft = buildCheckoutDraft(base);
    expect(draft.items).toHaveLength(1);
    expect(draft.totals.shippingMinor).toBe(19000);
    expect(draft.totals.totalMinor).toBe(268000);
    expect(draft.delivery.address?.locality).toBe('Pocitos');
    expect(draft.payment.status).toBe('pending');
    expect(draft.payment.installments).toBe(6);
  });

  it('drops the address and the fee for pickup', () => {
    const draft = buildCheckoutDraft({ ...base, deliveryMethod: pickup });
    expect(draft.delivery.address).toBeNull();
    expect(draft.totals.shippingMinor).toBe(0);
    expect(draft.totals.totalMinor).toBe(249000);
  });

  it('demands an address when the method ships', () => {
    expect(() => buildCheckoutDraft({ ...base, address: null })).toThrow(DomainError);
  });

  it('refuses to sell from a paused store', () => {
    expect(() => buildCheckoutDraft({ ...base, store: makeStore({ status: 'paused' }) })).toThrow(
      DomainError,
    );
  });

  it('refuses to sell an unpublished product', () => {
    const product = makeProduct({ status: 'draft' });
    expect(() =>
      buildCheckoutDraft({
        ...base,
        lines: [{ product, variantId: asVariantId('variant-1'), quantity: 1 }],
      }),
    ).toThrow(DomainError);
  });

  it('refuses a quantity above the available stock', () => {
    expect(() =>
      buildCheckoutDraft({
        ...base,
        lines: [{ product: makeProduct(), variantId: asVariantId('variant-1'), quantity: 99 }],
      }),
    ).toThrow(DomainError);
  });

  it('clamps installments to what the method supports', () => {
    const draft = buildCheckoutDraft({ ...base, installments: 999 });
    expect(draft.payment.installments).toBe(mercadoPago.maxInstallments);
  });
});

describe('order code', () => {
  it('is deterministic and readable', () => {
    expect(buildOrderCode('order-1')).toBe(buildOrderCode('order-1'));
    expect(buildOrderCode('order-1')).toMatch(/^VV-[2-9A-HJ-NP-Z]{5}$/);
    expect(buildOrderCode('order-1')).not.toBe(buildOrderCode('order-2'));
  });
});
