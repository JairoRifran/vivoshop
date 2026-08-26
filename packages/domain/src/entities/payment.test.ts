import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  assertPaymentTransition,
  canTransitionPayment,
  checkoutReservationDeadline,
  isCheckoutReservationLapsed,
  isPaymentSettled,
  orderStatusForPayment,
  releasesStock,
  type PaymentStatus,
} from './payment';

/**
 * El pago es donde M03 puede hacer el daño más caro: mostrarle "venta
 * confirmada" a alguien que no cobró, o dejar unidades bloqueadas para siempre
 * porque un comprador cerró la pestaña. El grafo se enumera entero en vez de
 * probarlo por muestreo.
 */
describe('máquina de estados del pago', () => {
  const ALL: readonly PaymentStatus[] = PAYMENT_STATUSES;

  const LEGAL: ReadonlyArray<readonly [PaymentStatus, PaymentStatus]> = [
    ['pending', 'approved'],
    ['pending', 'rejected'],
    ['pending', 'cancelled'],
    ['pending', 'expired'],
    ['approved', 'refunded'],
  ];

  it('acepta exactamente las transiciones legales y ninguna más', () => {
    const legal = new Set(LEGAL.map(([from, to]) => from + '->' + to));

    for (const from of ALL) {
      for (const to of ALL) {
        expect({ from, to, permitido: canTransitionPayment(from, to) }).toEqual({
          from,
          to,
          permitido: legal.has(from + '->' + to),
        });
      }
    }
  });

  it('un pago aprobado no se cancela: se reembolsa', () => {
    // La distinción no es cosmética. Cancelar sugiere que nunca hubo plata;
    // reembolsar dice que la hubo y volvió, que es lo que pasó de verdad.
    expect(canTransitionPayment('approved', 'cancelled')).toBe(false);
    expect(canTransitionPayment('approved', 'refunded')).toBe(true);
  });

  it('deja los estados finales cerrados', () => {
    for (const from of ['rejected', 'cancelled', 'expired', 'refunded'] as const) {
      for (const to of ALL) {
        expect(canTransitionPayment(from, to)).toBe(false);
      }
    }
  });

  it('reporta un código estable que la API puede mapear', () => {
    try {
      assertPaymentTransition('rejected', 'approved');
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INVALID_PAYMENT_TRANSITION');
    }
  });

  it('solo pending sigue en movimiento', () => {
    expect(isPaymentSettled('pending')).toBe(false);
    for (const status of ALL.filter((s) => s !== 'pending')) {
      expect(isPaymentSettled(status)).toBe(true);
    }
  });
});

describe('liberación de stock', () => {
  it('devuelve las unidades cuando el pago no va a llegar', () => {
    expect(releasesStock('rejected')).toBe(true);
    expect(releasesStock('cancelled')).toBe(true);
    expect(releasesStock('expired')).toBe(true);
  });

  it('no las devuelve mientras el pago sigue vivo ni cuando se cobró', () => {
    // Liberar en `pending` sería vender dos veces la misma unidad; liberar en
    // `approved` sería regalar mercadería ya vendida.
    expect(releasesStock('pending')).toBe(false);
    expect(releasesStock('approved')).toBe(false);
  });

  it('un reembolso no repone stock solo', () => {
    // La mercadería pudo haberse despachado. Reponerla automáticamente
    // inventaría unidades que no están en el depósito.
    expect(releasesStock('refunded')).toBe(false);
  });
});

describe('efecto del pago sobre el pedido', () => {
  it('aprobar el pago es lo único que marca el pedido como pagado', () => {
    expect(orderStatusForPayment('approved')).toBe('paid');
    expect(orderStatusForPayment('pending')).toBeNull();
  });

  it('rechazo, cancelación y vencimiento cancelan el pedido', () => {
    expect(orderStatusForPayment('rejected')).toBe('cancelled');
    expect(orderStatusForPayment('cancelled')).toBe('cancelled');
    expect(orderStatusForPayment('expired')).toBe('cancelled');
  });

  it('un reembolso no decide por el vendedor', () => {
    expect(orderStatusForPayment('refunded')).toBeNull();
  });
});

describe('propósito del pago', () => {
  it('contempla cobros que no son compras', () => {
    // El día que se cobre por promocionar un vivo, tiene que entrar por el
    // mismo circuito y no por un segundo sistema de pagos.
    expect([...PAYMENT_PURPOSES]).toEqual(['order', 'live_promotion']);
  });
});

describe('la reserva de stock de un checkout', () => {
  const base = {
    status: 'pending' as PaymentStatus,
    createdAt: new Date('2026-08-26T12:00:00Z'),
    expiresAt: null,
  };
  const TTL = 1_800;

  it('manda la fecha del proveedor cuando existe', () => {
    // Es la que ve el comprador en la pantalla de pago. Liberar antes sería
    // quitarle el producto a alguien que todavía está en tiempo de pagarlo.
    const conFecha = { ...base, expiresAt: new Date('2026-08-26T18:00:00Z') };
    expect(checkoutReservationDeadline(conFecha, TTL)).toEqual(
      new Date('2026-08-26T18:00:00Z'),
    );
    // Y gana incluso cuando es más lejana que el TTL local.
    expect(isCheckoutReservationLapsed(conFecha, new Date('2026-08-26T13:00:00Z'), TTL)).toBe(
      false,
    );
  });

  it('sin fecha del proveedor, vale el TTL local', () => {
    expect(checkoutReservationDeadline(base, TTL)).toEqual(new Date('2026-08-26T12:30:00Z'));
  });

  it('vence justo al cumplirse el plazo, no un segundo después', () => {
    expect(isCheckoutReservationLapsed(base, new Date('2026-08-26T12:29:59Z'), TTL)).toBe(false);
    expect(isCheckoutReservationLapsed(base, new Date('2026-08-26T12:30:00Z'), TTL)).toBe(true);
  });

  it('un pago ya resuelto no tiene reserva que vencer', () => {
    // Primera defensa contra liberar dos veces: `approved` ya la consumió y
    // `rejected`/`cancelled`/`expired` ya la devolvieron. La segunda defensa es
    // la máquina de estados, que solo deja salir de `pending` una vez.
    const tarde = new Date('2027-01-01T00:00:00Z');
    for (const status of ['approved', 'rejected', 'cancelled', 'expired', 'refunded'] as const) {
      expect(isCheckoutReservationLapsed({ ...base, status }, tarde, TTL)).toBe(false);
    }
  });
});
