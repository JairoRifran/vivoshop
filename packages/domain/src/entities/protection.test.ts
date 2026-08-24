import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_DEADLINES,
  NO_PAYMENT_CAPABILITIES,
  canAutoComplete,
  canPromiseProtection,
  canTransitionProtection,
  initialProtection,
  initialSettlement,
  protectionLevel,
  shippingBreach,
  shouldAttemptRelease,
  shouldReleaseStock,
  shouldRemindToShip,
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

describe('la promesa depende exactamente de lo que el proveedor garantiza', () => {
  it('no promete nada cuando el proveedor no puede nada', () => {
    expect(protectionLevel(NO_PAYMENT_CAPABILITIES)).toBe('none');
    expect(canPromiseProtection(NO_PAYMENT_CAPABILITIES)).toBe(false);
    expect(initialProtection(NO_PAYMENT_CAPABILITIES)).toBe('not_applicable');
    expect(initialSettlement(NO_PAYMENT_CAPABILITIES)).toBe('not_supported');
  });

  it('reembolsar no alcanza para el escudo', () => {
    // Poder devolver plata después no es retenerla antes. Se puede decir "si
    // algo sale mal te lo devolvemos"; no se puede decir "queda retenido".
    expect(protectionLevel(sinRetencion)).toBe('refund_only');
    expect(canPromiseProtection(sinRetencion)).toBe(false);
    expect(initialProtection(sinRetencion)).toBe('not_applicable');
  });

  it('retener sin poder devolver tampoco alcanza', () => {
    // Dejaría la plata trabada sin salida: peor que no prometer nada.
    const soloRetiene = { ...NO_PAYMENT_CAPABILITIES, supportsDelayedSettlement: true };
    expect(protectionLevel(soloRetiene)).toBe('none');
    expect(canPromiseProtection(soloRetiene)).toBe(false);
  });

  it('retener y devolver sin circuito de reclamos tampoco', () => {
    // El comprador no tendría cómo pedirlo.
    const sinReclamos = {
      ...NO_PAYMENT_CAPABILITIES,
      supportsDelayedSettlement: true,
      supportsRefunds: true,
    };
    expect(protectionLevel(sinReclamos)).toBe('refund_only');
    expect(canPromiseProtection(sinReclamos)).toBe(false);
  });

  it('el escudo exige las tres capacidades juntas', () => {
    expect(protectionLevel(conRetencion)).toBe('full');
    expect(canPromiseProtection(conRetencion)).toBe(true);
    expect(initialProtection(conRetencion)).toBe('eligible');
    expect(initialSettlement(conRetencion)).toBe('pending_release');
  });
});

describe('completar el pedido no es liberar la plata', () => {
  it('completed con pending_release es una combinación válida', () => {
    // El pedido se cerró y el proveedor todavía no liberó. Es lo normal, no
    // una inconsistencia: son dos ejes distintos.
    expect(
      shouldAttemptRelease({
        orderStatus: 'completed',
        settlement: 'pending_release',
        protection: 'protected',
      }),
    ).toBe(true);
  });

  it('no se pide liberar antes de completar', () => {
    for (const orderStatus of ['paid', 'shipped', 'delivered']) {
      expect(
        shouldAttemptRelease({ orderStatus, settlement: 'pending_release', protection: 'protected' }),
      ).toBe(false);
    }
  });

  it('no se pide liberar lo que ya se liberó ni lo que el proveedor no retiene', () => {
    for (const settlement of ['released', 'not_supported', 'held'] as const) {
      expect(
        shouldAttemptRelease({ orderStatus: 'completed', settlement, protection: 'protected' }),
      ).toBe(false);
    }
  });

  it('un reclamo abierto frena la liberación aunque el pedido esté completo', () => {
    expect(
      shouldAttemptRelease({
        orderStatus: 'completed',
        settlement: 'pending_release',
        protection: 'disputed',
      }),
    ).toBe(false);
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
