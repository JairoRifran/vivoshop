import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  money,
  scheduleLabel,
  timelineLabel,
  viewers,
} from './format';

const NOW = new Date('2026-03-01T20:00:00.000Z');

describe('money', () => {
  it('renders Uruguayan pesos from minor units', () => {
    expect(money(249000)).toContain('2.490,00');
    expect(money(0)).toContain('0,00');
  });
});

describe('viewers', () => {
  it('shows exact numbers until they stop being readable', () => {
    expect(viewers(327)).toBe('327');
    expect(viewers(18400)).not.toBe('18400');
  });
});

describe('order status copy', () => {
  it('labels every status a buyer can see', () => {
    for (const status of Object.keys(ORDER_STATUS_LABEL)) {
      expect(ORDER_STATUS_LABEL[status as keyof typeof ORDER_STATUS_LABEL]).toBeTruthy();
      expect(ORDER_STATUS_TONE[status as keyof typeof ORDER_STATUS_TONE]).toBeTruthy();
    }
  });

  it('adapts the wording to how the order is delivered', () => {
    // "Enviado" is nonsense for something you collect yourself.
    expect(timelineLabel('shipped', 'pickup')).toBe('Listo para retirar');
    expect(timelineLabel('delivered', 'pickup')).toBe('Retirado');
    expect(timelineLabel('shipped', 'shipping')).toBe('Enviado');
    expect(timelineLabel('shipped', 'seller_coordination')).toBe('En camino');
  });
});

describe('schedule labels', () => {
  it('prefers "Hoy" and "Mañana" over a bare date', () => {
    expect(scheduleLabel('2026-03-01T22:30:00.000Z', NOW)).toMatch(/^Hoy /);
    expect(scheduleLabel('2026-03-02T22:30:00.000Z', NOW)).toMatch(/^Mañana /);
  });

  it('falls back to a weekday further out', () => {
    const label = scheduleLabel('2026-03-06T22:30:00.000Z', NOW);
    expect(label).not.toMatch(/^Hoy|^Mañana/);
    expect(label.length).toBeGreaterThan(3);
  });

  it('never renders an empty slot for a session with no date', () => {
    expect(scheduleLabel(null, NOW)).toBe('Sin fecha');
  });
});
