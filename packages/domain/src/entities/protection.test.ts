import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_DEADLINES,
  NO_PAYMENT_CAPABILITIES,
  canAutoComplete,
  canPromiseProtection,
  canTransitionProtection,
  initialProtection,
  initialSettlement,
  shouldReleaseStock,
  shouldRemindToShip,
  shippingBreach,
  type PaymentCapabilities,
} from './protection';

const conRetencion: PaymentCapabilities = {
  supportsDelayedSettlement: true,
  supportsManualRelease: true,
  supportsDisputes: true,
  supportsRefunds: true,
};

const sinRetencion: PaymentCapabilities = {
  ...NO_PAYMENT_CAPABILITIES,
  supportsRefunds: true,
};

describe('la promesa de Compra Protegida depende del proveedor', () => {
  it('no se promete nada sin liquidación diferida', () => {
    // La regla que evita mentirle al comprador: si el proveedor liquida al
    // instante, no hay nada retenido y no hay nada que prometer.
    expect(canPromiseProtection(sinRetencion)).toBe(false);
    expect(initialProtection(sinRetencion)).toBe('not_applicable');
    expect(initialSettlement(sinRetencion)).toBe('not_supported');
  });

  it('se promete solo cuando el proveedor puede retener', () => {
    expect(canPromiseProtection(conRetencion)).toBe(true);
    expect(initialProtection(conRetencion)).toBe('eligible');
    expect(initialSettlement(conRetencion)).toBe('pending_release');
  });

  it('reembolsar no alcanza para prometer protección', () => {
    // Poder devolver plata después no es lo mismo que retenerla antes.
    expect(canPromiseProtection({ ...NO_PAYMENT_CAPABILITIES, supportsRefunds: true })).toBe(false);
  });
});

describe('estados de protección', () => {
  it('solo se protege lo que era elegible', () => {
    expect(canTransitionProtection('eligible', 'protected')).toBe(true);
    expect(canTransitionProtection('not_applicable', 'protected')).toBe(false);
  });

  it('un reclamo solo sale de una compra protegida', () => {
    expect(canTransitionProtection('protected', 'disputed')).toBe(true);
    expect(canTransitionProtection('eligible', 'disputed')).toBe(false);
  });

  it('resuelto es final', () => {
    for (const to of ['protected', 'disputed', 'eligible', 'not_applicable'] as const) {
      expect(canTransitionProtection('resolved', to)).toBe(false);
    }
  });
});

describe('stock: devolver dinero no es devolver producto', () => {
  const antesDeEnviar = { shippedAt: null };
  const yaEnviado = { shippedAt: new Date('2026-03-01T10:00:00Z') };

  it('libera stock cuando el pago se cae antes del envío', () => {
    for (const paymentStatus of ['rejected', 'cancelled', 'expired'] as const) {
      expect(shouldReleaseStock({ paymentStatus, ...antesDeEnviar })).toBe(true);
    }
  });

  it('no libera stock mientras el pago sigue vivo ni cuando se cobró', () => {
    expect(shouldReleaseStock({ paymentStatus: 'pending', ...antesDeEnviar })).toBe(false);
    expect(shouldReleaseStock({ paymentStatus: 'approved', ...antesDeEnviar })).toBe(false);
  });

  it('un reembolso después del envío NO repone stock', () => {
    // La mercadería salió. Reponerla inventaría unidades que no están en el
    // depósito, y el vendedor terminaría vendiendo algo que no tiene.
    expect(shouldReleaseStock({ paymentStatus: 'refunded', ...yaEnviado })).toBe(false);
  });

  it('tampoco repone stock una cancelación posterior al envío', () => {
    expect(shouldReleaseStock({ paymentStatus: 'cancelled', ...yaEnviado })).toBe(false);
  });
});

describe('cuando nadie hace nada', () => {
  const pagado = new Date('2026-03-01T10:00:00Z');
  const enSegundos = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);

  it('avisa al vendedor antes de que se le venza el plazo', () => {
    const order = { paidAt: pagado, shippedAt: null };
    const casi = enSegundos(pagado, FULFILLMENT_DEADLINES.shipReminderSeconds);
    expect(shouldRemindToShip(order, casi)).toBe(true);
    expect(shippingBreach(order, casi)).toBe('none');
  });

  it('registra el incumplimiento pasado el plazo', () => {
    const order = { paidAt: pagado, shippedAt: null };
    const tarde = enSegundos(pagado, FULFILLMENT_DEADLINES.shipBySeconds);
    expect(shippingBreach(order, tarde)).toBe('shipping_overdue');
    // Ya no tiene sentido recordarle: el plazo venció.
    expect(shouldRemindToShip(order, tarde)).toBe(false);
  });

  it('no reclama nada si el vendedor despachó', () => {
    const order = { paidAt: pagado, shippedAt: enSegundos(pagado, 3600) };
    expect(shippingBreach(order, enSegundos(pagado, 10 * 24 * 3600))).toBe('none');
  });

  it('completa sola la compra si el comprador no confirma', () => {
    // El sistema no puede depender del botón "Recibí mi compra".
    const entregado = new Date('2026-03-05T10:00:00Z');
    const order = { deliveredAt: entregado, protection: 'protected' as const };
    expect(canAutoComplete(order, enSegundos(entregado, FULFILLMENT_DEADLINES.autoCompleteSeconds)))
      .toBe(true);
    expect(canAutoComplete(order, enSegundos(entregado, 3600))).toBe(false);
  });

  it('no completa sola una compra reclamada', () => {
    const entregado = new Date('2026-03-05T10:00:00Z');
    const order = { deliveredAt: entregado, protection: 'disputed' as const };
    expect(canAutoComplete(order, enSegundos(entregado, 30 * 24 * 3600))).toBe(false);
  });
});
