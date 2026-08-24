import { getMarket, type TaxConfig, type TaxRule } from '@vivo/config';
import { describe, expect, it } from 'vitest';
import { makeProduct } from '../testing/fixtures';
import { money } from '../value-objects/money';
import { buildOrderItem, calculateOrderTotals } from './pricing';
import { isInclusive, resolveTaxRule, summarizeTax, taxForAmount } from './tax';

const uy = getMarket('UY').tax;

const ADDITIVE: TaxConfig = {
  defaultCategory: 'standard',
  rules: {
    standard: { treatment: 'added', rateBps: 1000, label: 'Sales tax', category: 'standard' },
  },
};

describe('resolving a rule', () => {
  it('uses the product category when it declares one', () => {
    expect(resolveTaxRule(uy, makeProduct({ taxCategory: 'reduced' })).rateBps).toBe(1000);
    expect(resolveTaxRule(uy, makeProduct({ taxCategory: 'exempt' })).treatment).toBe('exempt');
  });

  it('falls back to the market default for a plain product', () => {
    expect(resolveTaxRule(uy, makeProduct({ taxCategory: null })).category).toBe('standard');
    expect(resolveTaxRule(uy).rateBps).toBe(2200);
  });

  it('degrades to the default rather than throwing on an unknown category', () => {
    expect(resolveTaxRule(uy, makeProduct({ taxCategory: 'no-existe' })).category).toBe('standard');
  });
});

describe('computing tax', () => {
  it('extracts inclusive tax from the gross amount', () => {
    // 22% inside 12.200 is 2.200 over a 10.000 net.
    const rule = uy.rules.standard as TaxRule;
    expect(taxForAmount(money(1_220_000, 'UYU'), rule).amountMinor).toBe(220_000);
  });

  it('adds additive tax on top', () => {
    const rule = ADDITIVE.rules.standard as TaxRule;
    expect(taxForAmount(money(100_000, 'UYU'), rule).amountMinor).toBe(10_000);
  });

  it('charges nothing for an exempt rule', () => {
    const rule = uy.rules.exempt as TaxRule;
    expect(taxForAmount(money(999_999, 'UYU'), rule).amountMinor).toBe(0);
  });

  it('treats exempt as already-inclusive for total arithmetic', () => {
    expect(isInclusive({ treatment: 'included' })).toBe(true);
    expect(isInclusive({ treatment: 'exempt' })).toBe(true);
    expect(isInclusive({ treatment: 'added' })).toBe(false);
  });
});

describe('summarising an order', () => {
  it('keeps the rule verbatim when every line shares it', () => {
    const rule = uy.rules.standard as TaxRule;
    const snapshot = summarizeTax([
      { rule, amountMinor: 100, baseMinor: 554 },
      { rule, amountMinor: 200, baseMinor: 1109 },
    ]);

    expect(snapshot.category).toBe('standard');
    expect(snapshot.rateBps).toBe(2200);
    expect(snapshot.amountMinor).toBe(300);
  });

  it('reports an effective rate when an order mixes categories', () => {
    const standard = uy.rules.standard as TaxRule;
    const exempt = uy.rules.exempt as TaxRule;

    const snapshot = summarizeTax([
      { rule: standard, amountMinor: 1000, baseMinor: 5545 },
      { rule: exempt, amountMinor: 0, baseMinor: 4455 },
    ]);

    expect(snapshot.category).toBe('mixed');
    expect(snapshot.amountMinor).toBe(1000);
    // Effective rate over the combined base, not either line's rate.
    expect(snapshot.rateBps).toBe(1000);
  });
});

describe('order totals with per-line rules', () => {
  it('matches the whole-total result when the order is single-rate', () => {
    const product = makeProduct();
    const items = [buildOrderItem(product, product.variants[0]!, 1, uy)];
    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: 19000,
      tax: uy,
    });

    expect(totals.totalMinor).toBe(268000);
    expect(totals.taxMinor).toBe(48328);
    expect(totals.tax.category).toBe('standard');
  });

  it('charges no tax on an exempt product but still bills the shipping', () => {
    const product = makeProduct({ taxCategory: 'exempt' });
    const items = [buildOrderItem(product, product.variants[0]!, 1, uy)];

    expect(items[0]?.taxAmountMinor).toBe(0);
    expect(items[0]?.taxCategory).toBe('exempt');

    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: 19000,
      tax: uy,
    });

    // Only the shipping carries tax, and the buyer still pays the same total.
    expect(totals.totalMinor).toBe(268000);
    expect(totals.taxMinor).toBe(3426);
    expect(totals.tax.category).toBe('mixed');
  });

  it('adds the tax on top in an additive market', () => {
    const product = makeProduct();
    const items = [buildOrderItem(product, product.variants[0]!, 1, ADDITIVE)];
    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: 0,
      tax: ADDITIVE,
    });

    expect(totals.subtotalMinor).toBe(249000);
    expect(totals.taxMinor).toBe(24900);
    expect(totals.totalMinor).toBe(273900);
    expect(totals.tax.treatment).toBe('added');
  });

  it('freezes the rate on the line, so a later rate change cannot rewrite it', () => {
    const product = makeProduct();
    const item = buildOrderItem(product, product.variants[0]!, 2, uy);

    expect(item.taxRateBps).toBe(2200);
    expect(item.taxCategory).toBe('standard');
    expect(item.taxAmountMinor).toBe(89803);
  });
});
