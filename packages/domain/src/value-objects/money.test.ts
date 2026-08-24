import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  addMoney,
  compareMoney,
  money,
  multiplyMoney,
  percentOfMoney,
  subtractMoney,
  sumMoney,
  taxPortionOfGross,
  zeroMoney,
} from './money';

describe('money', () => {
  it('rejects non-integer amounts so cents never drift', () => {
    expect(() => money(10.5, 'UYU')).toThrow(DomainError);
    expect(() => money(10.5, 'UYU')).toThrow(/integer/i);
  });

  it('adds and subtracts within one currency', () => {
    expect(addMoney(money(100, 'UYU'), money(250, 'UYU')).amountMinor).toBe(350);
    expect(subtractMoney(money(300, 'UYU'), money(100, 'UYU')).amountMinor).toBe(200);
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(100, 'UYU'), money(100, 'ARS'))).toThrow(DomainError);
    try {
      addMoney(money(100, 'UYU'), money(100, 'ARS'));
    } catch (error) {
      expect((error as DomainError).code).toBe('CURRENCY_MISMATCH');
    }
  });

  it('sums an empty list into zero of the requested currency', () => {
    expect(sumMoney([], 'UYU')).toEqual(zeroMoney('UYU'));
  });

  it('multiplies by a quantity with half-up rounding', () => {
    expect(multiplyMoney(money(333, 'UYU'), 3).amountMinor).toBe(999);
    expect(multiplyMoney(money(101, 'UYU'), 0.5).amountMinor).toBe(51);
  });

  it('computes a percentage in basis points', () => {
    expect(percentOfMoney(money(10_000, 'UYU'), 2200).amountMinor).toBe(2200);
  });

  it('extracts the tax already contained in a gross amount', () => {
    // 22% IVA inside 12.200 -> 2.200 of tax over a 10.000 net.
    expect(taxPortionOfGross(money(1_220_000, 'UYU'), 2200).amountMinor).toBe(220_000);
    expect(taxPortionOfGross(money(1000, 'UYU'), 0).amountMinor).toBe(0);
  });

  it('compares amounts', () => {
    expect(compareMoney(money(200, 'UYU'), money(100, 'UYU'))).toBeGreaterThan(0);
  });
});
