import type { CountryCode, LocaleCode } from './countries';
import { getMarket } from './markets';

export function formatDateTime(
  value: Date | string,
  locale: LocaleCode = 'es-UY',
  timeZone = 'America/Montevideo',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatDate(
  value: Date | string,
  locale: LocaleCode = 'es-UY',
  timeZone = 'America/Montevideo',
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/**
 * Short relative label such as "en 2 h" or "hace 5 min". `now` is injectable
 * so callers can render deterministically on the server and in tests.
 */
export function formatRelative(
  value: Date | string,
  locale: LocaleCode = 'es-UY',
  now: Date = new Date(),
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let amount = diffSeconds;
  for (const [unit, step] of thresholds) {
    if (Math.abs(amount) < step) return formatter.format(Math.round(amount), unit);
    amount /= step;
  }
  return formatter.format(Math.round(amount), 'year');
}

/** Compact viewer counters: 327, 1,2 mil, 18 mil. */
export function formatCount(value: number, locale: LocaleCode = 'es-UY'): string {
  if (value < 1000) return new Intl.NumberFormat(locale).format(value);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Elapsed live time as mm:ss or h:mm:ss. */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/** Strips separators and prefixes the market calling code when absent. */
export function normalizePhone(input: string, country: CountryCode = 'UY'): string {
  const { phone } = getMarket(country);
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return `${phone.callingCode}${digits.replace(/^0+/, '')}`;
}

export function isValidPhone(input: string, country: CountryCode = 'UY'): boolean {
  const { phone } = getMarket(country);
  const national = normalizePhone(input, country).slice(phone.callingCode.length);
  return phone.nationalDigits.includes(national.length);
}
