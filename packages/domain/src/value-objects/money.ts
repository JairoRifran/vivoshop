import type { CurrencyCode } from '@vivo/config';
import { DomainError } from '../errors';

/**
 * Money is always an integer in the currency's minor unit. No floats ever
 * reach persistence or arithmetic; rendering is the only place decimals exist,
 * and it lives in `@vivo/config`.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new DomainError('INVALID_MONEY', 'Money must be an integer amount in minor units', {
      amountMinor,
    });
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new DomainError('INVALID_MONEY', 'Money amount exceeds the safe integer range', {
      amountMinor,
    });
  }
  return { amountMinor, currency };
}

export function zeroMoney(currency: CurrencyCode): Money {
  return { amountMinor: 0, currency };
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('CURRENCY_MISMATCH', 'Cannot combine amounts in different currencies', {
      left: a.currency,
      right: b.currency,
    });
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(amounts: readonly Money[], currency: CurrencyCode): Money {
  return amounts.reduce<Money>((total, current) => addMoney(total, current), zeroMoney(currency));
}

/** Multiplies by a whole quantity. Half-up rounding keeps totals predictable. */
export function multiplyMoney(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new DomainError('INVALID_MONEY', 'Money factor must be finite', { factor });
  }
  return money(Math.round(value.amountMinor * factor), value.currency);
}

/** Basis points, so 2200 bps = 22%. */
export function percentOfMoney(value: Money, basisPoints: number): Money {
  return money(Math.round((value.amountMinor * basisPoints) / 10_000), value.currency);
}

/**
 * For tax-inclusive markets: the portion of a gross amount that is tax.
 * gross = net * (1 + rate)  =>  tax = gross * rate / (1 + rate)
 */
export function taxPortionOfGross(gross: Money, rateBps: number): Money {
  if (rateBps <= 0) return zeroMoney(gross.currency);
  return money(
    Math.round((gross.amountMinor * rateBps) / (10_000 + rateBps)),
    gross.currency,
  );
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

export function isZeroMoney(value: Money): boolean {
  return value.amountMinor === 0;
}

export function isNegativeMoney(value: Money): boolean {
  return value.amountMinor < 0;
}
