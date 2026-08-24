import type { LocaleCode } from './countries';

export const CURRENCY_CODES = ['UYU', 'ARS', 'CLP', 'PYG', 'BRL', 'USD'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyDefinition {
  readonly code: CurrencyCode;
  readonly symbol: string;
  /** Digits after the decimal separator. Zero for CLP and PYG. */
  readonly minorUnits: number;
  readonly name: string;
}

const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {
  UYU: { code: 'UYU', symbol: '$', minorUnits: 2, name: 'Peso uruguayo' },
  ARS: { code: 'ARS', symbol: '$', minorUnits: 2, name: 'Peso argentino' },
  CLP: { code: 'CLP', symbol: '$', minorUnits: 0, name: 'Peso chileno' },
  PYG: { code: 'PYG', symbol: '₲', minorUnits: 0, name: 'Guaraní' },
  BRL: { code: 'BRL', symbol: 'R$', minorUnits: 2, name: 'Real' },
  USD: { code: 'USD', symbol: 'US$', minorUnits: 2, name: 'Dólar estadounidense' },
};

export function getCurrency(code: CurrencyCode): CurrencyDefinition {
  const currency = CURRENCIES[code];
  /* c8 ignore next */
  if (!currency) throw new Error(`Unknown currency: ${code}`);
  return currency;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * Amounts travel through the system as integers in the currency's minor unit
 * (cents for UYU, whole units for CLP). Formatting is the only place that
 * knows how to render them, and it always needs a locale.
 */
export function formatMoney(
  amountMinor: number,
  currency: CurrencyCode,
  locale: LocaleCode = 'es-UY',
  options: { showCode?: boolean; compact?: boolean } = {},
): string {
  const definition = getCurrency(currency);
  const value = amountMinor / 10 ** definition.minorUnits;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: definition.minorUnits,
    maximumFractionDigits: definition.minorUnits,
    ...(options.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
  }).format(value);

  const base = `${definition.symbol} ${formatted}`;
  return options.showCode ? `${base} ${definition.code}` : base;
}

/** Turns user input such as "2.490,50" or "2490.5" into minor units. */
export function parseMoneyInput(input: string, currency: CurrencyCode): number | null {
  const definition = getCurrency(currency);
  const normalized = input
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');

  if (normalized === '' || normalized === '-') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  return Math.round(value * 10 ** definition.minorUnits);
}
