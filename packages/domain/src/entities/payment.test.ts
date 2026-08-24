import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  assertPaymentTransition,
  canTransitionPayment,
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
