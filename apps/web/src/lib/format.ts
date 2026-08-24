import {
  formatCount,
  formatDateTime,
  formatMoney,
  formatRelative,
  type CurrencyCode,
  type LocaleCode,
} from '@vivo/config';
import type { OrderStatus } from '@vivo/domain';

export const LOCALE: LocaleCode = 'es-UY';

export function money(amountMinor: number, currency: CurrencyCode = 'UYU'): string {
  return formatMoney(amountMinor, currency, LOCALE);
}

export function viewers(count: number): string {
  return formatCount(count, LOCALE);
}

export function dateTime(value: string | Date): string {
  return formatDateTime(value, LOCALE);
}

export function relative(value: string | Date, now?: Date): string {
  return formatRelative(value, LOCALE, now);
}

/** Buyer-facing wording per order status, plus the tone its chip should use. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'Pendiente de pago',
  paid: 'Pagado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> =
  {
    pending_payment: 'warning',
    paid: 'info',
    preparing: 'info',
    shipped: 'info',
    delivered: 'success',
    cancelled: 'danger',
  };

/**
 * "Enviado" makes no sense for a pickup order. The timeline copy adapts to how
 * the buyer actually receives the thing.
 */
export function timelineLabel(status: OrderStatus, kind: string): string {
  if (status === 'shipped') {
    if (kind === 'pickup') return 'Listo para retirar';
    if (kind === 'seller_coordination') return 'En camino';
  }
  if (status === 'delivered' && kind === 'pickup') return 'Retirado';
  return ORDER_STATUS_LABEL[status];
}

export const STORE_CATEGORY_LABEL: Record<string, string> = {
  moda: 'Moda',
  belleza: 'Belleza',
  hogar: 'Hogar',
  coleccionables: 'Coleccionables',
  tecnologia: 'Tecnología',
  otros: 'Otros',
};

/** Live sessions are announced in local time with a friendly day name. */
export function scheduleLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'Sin fecha';
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Montevideo',
  }).format(date);

  if (sameDay) return `Hoy ${time}`;
  if (isTomorrow) return `Mañana ${time}`;

  const day = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'America/Montevideo',
  }).format(date);
  return `${day} ${time}`;
}
