import { describe, expect, it } from 'vitest';
import { formatCount, formatElapsed, isValidPhone, normalizePhone } from './format';
import { formatMoney, getCurrency, parseMoneyInput } from './currency';
import { DEFAULT_COUNTRY, getDeliveryMethod, getMarket, listMarkets } from './markets';
import { resolveTaxRuleFromConfig } from './tax';
import { findRegion, getRegions } from './regions';

describe('currency', () => {
  it('keeps zero-decimal currencies free of cents', () => {
    expect(getCurrency('CLP').minorUnits).toBe(0);
    expect(getCurrency('UYU').minorUnits).toBe(2);
  });

  it('formats UYU amounts from minor units', () => {
    expect(formatMoney(249000, 'UYU')).toContain('2.490,00');
  });

  it('round-trips typed input into minor units', () => {
    expect(parseMoneyInput('2.490,50', 'UYU')).toBe(249050);
    expect(parseMoneyInput('2490', 'UYU')).toBe(249000);
    expect(parseMoneyInput('12000', 'CLP')).toBe(12000);
    expect(parseMoneyInput('', 'UYU')).toBeNull();
    expect(parseMoneyInput('abc', 'UYU')).toBeNull();
  });
});

describe('markets', () => {
  it('defaults to Uruguay', () => {
    expect(DEFAULT_COUNTRY).toBe('UY');
    expect(getMarket().currency).toBe('UYU');
    expect(getMarket().tax.rules.standard?.rateBps).toBe(2200);
    expect(getMarket().tax.rules.standard?.treatment).toBe('included');
  });

  it('exposes at least one planned market so expansion stays configuration', () => {
    expect(listMarkets('planned').length).toBeGreaterThan(0);
  });

  it('offers shipping, pickup and seller coordination in Uruguay', () => {
    const kinds = getMarket('UY').delivery.map((method) => method.kind);
    expect(kinds).toEqual(expect.arrayContaining(['shipping', 'pickup', 'seller_coordination']));
  });

  it('resolves a delivery method by id', () => {
    expect(getDeliveryMethod('UY', 'uy-pickup')?.flatFeeMinor).toBe(0);
    expect(getDeliveryMethod('UY', 'nope')).toBeUndefined();
  });
});

describe('tax rules', () => {
  it('resolves a category, and falls back to the market default', () => {
    const config = getMarket('UY').tax;
    expect(resolveTaxRuleFromConfig(config, 'reduced').rateBps).toBe(1000);
    expect(resolveTaxRuleFromConfig(config, 'exempt').treatment).toBe('exempt');
    // An unknown category must never throw: it degrades to the default rate.
    expect(resolveTaxRuleFromConfig(config, 'inventada').category).toBe('standard');
    expect(resolveTaxRuleFromConfig(config, null).rateBps).toBe(2200);
  });

  it('keeps a country from having a single hard-coded rate', () => {
    const uruguay = Object.keys(getMarket('UY').tax.rules);
    expect(uruguay.length).toBeGreaterThan(1);
  });
});

describe('regions', () => {
  it('lists the 19 Uruguayan departments', () => {
    expect(getRegions('UY')).toHaveLength(19);
  });

  it('finds a department by code', () => {
    expect(findRegion('UY', 'MO')?.name).toBe('Montevideo');
  });
});

describe('format', () => {
  it('renders elapsed live time', () => {
    expect(formatElapsed(75)).toBe('01:15');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });

  it('compacts large viewer counts', () => {
    expect(formatCount(327)).toBe('327');
    expect(formatCount(18400)).not.toBe('18400');
  });

  it('normalizes Uruguayan phone numbers', () => {
    expect(normalizePhone('099 123 456')).toBe('+59899123456');
    expect(isValidPhone('099 123 456')).toBe(true);
    expect(isValidPhone('12')).toBe(false);
  });
});
