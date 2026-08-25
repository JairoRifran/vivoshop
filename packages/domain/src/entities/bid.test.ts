import { describe, expect, it } from 'vitest';
import type { DomainError } from '../errors';
import {
  BID_SESSION_STATUSES,
  MAX_BID_MINOR,
  assertBidAcceptable,
  assertCanAccept,
  assertNotOwnBid,
  bidOutcome,
  canCheckoutBid,
  canTransitionBidSession,
  isReservationExpired,
  leadingBid,
  nextMinimumBid,
  reservationDeadline,
  reservationSecondsLeft,
  withOutcomes,
  type Bid,
  type BidSession,
  type BidSessionStatus,
} from './bid';
import {
  asBidId,
  asBidSessionId,
  asLiveSessionId,
  asOrderId,
  asProductId,
  asStoreId,
  asUserId,
  asVariantId,
} from '../value-objects/identifiers';

const AT = new Date('2026-03-01T20:00:00.000Z');

function makeSession(overrides: Partial<BidSession> = {}): BidSession {
  return {
    id: asBidSessionId('bs-1'),
    liveSessionId: asLiveSessionId('live-1'),
    storeId: asStoreId('store-1'),
    sellerId: asUserId('martina'),
    productId: asProductId('campera-vintage'),
    variantId: asVariantId('campera-vintage-v1'),
    status: 'open',
    currency: 'UYU',
    referencePriceMinor: 150_000,
    minimumBidMinor: null,
    minimumIncrementMinor: null,
    acceptedBidId: null,
    reservedUntil: null,
    orderId: null,
    closedReason: null,
    openedAt: AT,
    closedAt: null,
    ...overrides,
  };
}

let seq = 0;
function makeBid(overrides: Partial<Bid> = {}): Bid {
  seq += 1;
  return {
    id: asBidId(`bid-${seq}`),
    bidSessionId: asBidSessionId('bs-1'),
    buyerId: asUserId('ana'),
    buyerName: 'Ana',
    buyerAvatarUrl: null,
    amountMinor: 100_000,
    currency: 'UYU',
    status: 'active',
    createdAt: AT,
    ...overrides,
  };
}

const codeOf = (run: () => void): string => {
  try {
    run();
  } catch (error) {
    return (error as DomainError).code;
  }
  throw new Error('se esperaba un DomainError y no hubo ninguno');
};

describe('la puja no es una subasta: el vendedor decide', () => {
  it('la referencia no es un piso', () => {
    // El caso central del producto: se abre una puja para vender hoy, y una
    // oferta por debajo del catálogo es aceptable si al vendedor le sirve.
    const session = makeSession({ referencePriceMinor: 200_000 });
    const oferta = makeBid({ amountMinor: 160_000 });

    expect(() =>
      assertBidAcceptable({ session, leading: null, amountMinor: 160_000, currency: 'UYU' }),
    ).not.toThrow();
    expect(() => assertCanAccept(session, oferta)).not.toThrow();
  });

  it('no existe un camino que cierre la sesión sola', () => {
    // Nada acá mira un reloj para decidir un ganador. Si algún día hay
    // subastas cronometradas, van a ser una transición nueva y explícita.
    for (const from of BID_SESSION_STATUSES) {
      const destinos = BID_SESSION_STATUSES.filter((to) => canTransitionBidSession(from, to));
      expect({ from, destinos }).toEqual({
        from,
        destinos: {
          open: ['reserved', 'closed'],
          // En el orden de `BID_SESSION_STATUSES`, que es como los filtra.
          reserved: ['expired', 'sold', 'closed'],
          expired: ['open', 'closed'],
          sold: [],
          closed: [],
        }[from as BidSessionStatus],
      });
    }
  });

  it('se puede cerrar sin aceptar nada', () => {
    expect(canTransitionBidSession('open', 'closed')).toBe(true);
  });

  it('una sesión vendida o cerrada es final', () => {
    for (const to of BID_SESSION_STATUSES) {
      expect(canTransitionBidSession('sold', to)).toBe(false);
      expect(canTransitionBidSession('closed', to)).toBe(false);
    }
  });

  it('una reserva vencida vuelve a abrirse, no salta a vendida', () => {
    expect(canTransitionBidSession('expired', 'open')).toBe(true);
    expect(canTransitionBidSession('expired', 'sold')).toBe(false);
  });
});

describe('qué oferta se acepta', () => {
  it('cualquier monto positivo, cuando no hay mínimos', () => {
    const session = makeSession();
    expect(nextMinimumBid(session, null)).toBe(1);
    expect(() =>
      assertBidAcceptable({ session, leading: null, amountMinor: 1, currency: 'UYU' }),
    ).not.toThrow();
  });

  it('respeta el mínimo de la sesión', () => {
    const session = makeSession({ minimumBidMinor: 100_000 });
    expect(nextMinimumBid(session, null)).toBe(100_000);

    const error = codeOf(() =>
      assertBidAcceptable({ session, leading: null, amountMinor: 99_999, currency: 'UYU' }),
    );
    expect(error).toBe('BID_TOO_LOW');
  });

  it('respeta el incremento mínimo sobre la mejor oferta', () => {
    const session = makeSession({ minimumIncrementMinor: 5_000 });
    const leading = makeBid({ amountMinor: 125_000 });

    expect(nextMinimumBid(session, leading)).toBe(130_000);
    expect(
      codeOf(() =>
        assertBidAcceptable({ session, leading, amountMinor: 129_999, currency: 'UYU' }),
      ),
    ).toBe('BID_TOO_LOW');
    expect(() =>
      assertBidAcceptable({ session, leading, amountMinor: 130_000, currency: 'UYU' }),
    ).not.toThrow();
  });

  it('el error lleva el mínimo, que es lo que el comprador necesita', () => {
    const session = makeSession({ minimumIncrementMinor: 5_000 });
    const leading = makeBid({ amountMinor: 125_000 });

    try {
      assertBidAcceptable({ session, leading, amountMinor: 126_000, currency: 'UYU' });
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).details).toMatchObject({ minimumMinor: 130_000 });
    }
  });

  it('sin incremento configurado alcanza con superar por uno', () => {
    const session = makeSession();
    const leading = makeBid({ amountMinor: 125_000 });

    expect(nextMinimumBid(session, leading)).toBe(125_001);
    expect(
      codeOf(() =>
        assertBidAcceptable({ session, leading, amountMinor: 125_000, currency: 'UYU' }),
      ),
    ).toBe('BID_TOO_LOW');
  });

  it('rechaza montos que no son enteros positivos', () => {
    const session = makeSession();
    for (const amountMinor of [0, -1, -100_000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        codeOf(() => assertBidAcceptable({ session, leading: null, amountMinor, currency: 'UYU' })),
      ).toBe('INVALID_BID_AMOUNT');
    }
  });

  it('rechaza montos fuera de rango', () => {
    // Un cero de más en un teléfono, o un intento de desbordar el entero.
    const session = makeSession();
    expect(
      codeOf(() =>
        assertBidAcceptable({
          session,
          leading: null,
          amountMinor: MAX_BID_MINOR + 1,
          currency: 'UYU',
        }),
      ),
    ).toBe('INVALID_BID_AMOUNT');
    expect(
      codeOf(() =>
        assertBidAcceptable({
          session,
          leading: null,
          amountMinor: Number.MAX_SAFE_INTEGER,
          currency: 'UYU',
        }),
      ),
    ).toBe('INVALID_BID_AMOUNT');
  });

  it('rechaza otra moneda', () => {
    const session = makeSession();
    expect(
      codeOf(() =>
        assertBidAcceptable({ session, leading: null, amountMinor: 100_000, currency: 'USD' }),
      ),
    ).toBe('CURRENCY_MISMATCH');
  });

  it('no se puede ofertar en una sesión que no está abierta', () => {
    for (const status of ['reserved', 'expired', 'sold', 'closed'] as const) {
      const session = makeSession({ status });
      expect(
        codeOf(() =>
          assertBidAcceptable({ session, leading: null, amountMinor: 999_999, currency: 'UYU' }),
        ),
      ).toBe('BID_SESSION_NOT_OPEN');
    }
  });

  it('el dueño de la tienda no puede ofertar en su propia puja', () => {
    // Inflar el precio con ofertas propias tiene nombre y es fraude.
    const session = makeSession({ sellerId: asUserId('martina') });
    expect(codeOf(() => assertNotOwnBid(session, asUserId('martina')))).toBe(
      'CANNOT_BID_ON_OWN_STORE',
    );
    expect(() => assertNotOwnBid(session, asUserId('ana'))).not.toThrow();
  });
});

describe('cuál oferta manda', () => {
  it('la más alta', () => {
    const bids = [
      makeBid({ amountMinor: 90_000 }),
      makeBid({ amountMinor: 130_000 }),
      makeBid({ amountMinor: 115_000 }),
    ];
    expect(leadingBid(bids)?.amountMinor).toBe(130_000);
  });

  it('ante un empate, la que llegó primero', () => {
    // Cualquier otro criterio sería arbitrario y habría que explicárselo a
    // alguien que ofertó lo mismo y perdió.
    const temprana = makeBid({ amountMinor: 130_000, createdAt: new Date(AT.getTime()) });
    const tardia = makeBid({ amountMinor: 130_000, createdAt: new Date(AT.getTime() + 1_000) });

    expect(leadingBid([tardia, temprana])?.id).toBe(temprana.id);
    expect(leadingBid([temprana, tardia])?.id).toBe(temprana.id);
  });

  it('una oferta vencida no puede liderar', () => {
    const vencida = makeBid({ amountMinor: 200_000, status: 'expired' });
    const viva = makeBid({ amountMinor: 130_000 });
    expect(leadingBid([vencida, viva])?.id).toBe(viva.id);
  });

  it('sin ofertas no hay líder', () => {
    expect(leadingBid([])).toBeNull();
  });
});

describe('qué le pasó a cada oferta, sin escribirlo en la base', () => {
  it('la más alta lidera y las demás quedan superadas', () => {
    const session = makeSession();
    const baja = makeBid({ amountMinor: 100_000 });
    const alta = makeBid({ amountMinor: 130_000 });

    const outcomes = withOutcomes([baja, alta], session);
    expect(outcomes.find((entry) => entry.bid.id === alta.id)?.outcome).toBe('leading');
    expect(outcomes.find((entry) => entry.bid.id === baja.id)?.outcome).toBe('outbid');
  });

  it('la aceptada dice aceptada y el resto perdió', () => {
    const ganadora = makeBid({ amountMinor: 130_000, status: 'accepted' });
    const perdedora = makeBid({ amountMinor: 100_000 });
    const session = makeSession({ status: 'reserved', acceptedBidId: ganadora.id });

    const outcomes = withOutcomes([ganadora, perdedora], session);
    expect(outcomes.find((entry) => entry.bid.id === ganadora.id)?.outcome).toBe('accepted');
    expect(outcomes.find((entry) => entry.bid.id === perdedora.id)?.outcome).toBe('lost');
  });

  it('cerrada sin aceptar nada, todas perdieron', () => {
    const session = makeSession({ status: 'closed', closedReason: 'seller' });
    const outcomes = withOutcomes([makeBid(), makeBid({ amountMinor: 200_000 })], session);
    expect(outcomes.every((entry) => entry.outcome === 'lost')).toBe(true);
  });

  it('mientras la sesión sigue abierta nadie perdió todavía', () => {
    const session = makeSession();
    const outcomes = withOutcomes([makeBid(), makeBid({ amountMinor: 200_000 })], session);
    expect(outcomes.some((entry) => entry.outcome === 'lost')).toBe(false);
  });

  it('una oferta cuya reserva venció figura perdida', () => {
    const vencida = makeBid({ amountMinor: 130_000, status: 'expired' });
    const session = makeSession({ status: 'expired' });
    expect(bidOutcome(vencida, session)).toBe('lost');
  });
});

describe('aceptar', () => {
  it('acepta una oferta viva de una sesión abierta', () => {
    expect(() => assertCanAccept(makeSession(), makeBid())).not.toThrow();
  });

  it('no se puede aceptar dos veces', () => {
    // La segunda llega con la sesión ya reservada.
    const session = makeSession({ status: 'reserved', acceptedBidId: asBidId('bid-1') });
    expect(codeOf(() => assertCanAccept(session, makeBid()))).toBe('BID_SESSION_NOT_OPEN');
  });

  it('no se puede aceptar en una sesión ya cerrada', () => {
    const session = makeSession({ status: 'closed' });
    expect(codeOf(() => assertCanAccept(session, makeBid()))).toBe('BID_SESSION_NOT_OPEN');
  });

  it('no se puede aceptar una oferta de otra sesión', () => {
    const ajena = makeBid({ bidSessionId: asBidSessionId('bs-otra') });
    expect(codeOf(() => assertCanAccept(makeSession(), ajena))).toBe('BID_NOT_IN_SESSION');
  });

  it('no se puede aceptar una oferta que ya no está viva', () => {
    for (const status of ['accepted', 'expired'] as const) {
      expect(codeOf(() => assertCanAccept(makeSession(), makeBid({ status })))).toBe(
        'BID_NOT_ACTIVE',
      );
    }
  });
});

describe('la reserva', () => {
  const aceptadaEn = new Date('2026-03-01T20:00:00.000Z');
  const vence = reservationDeadline(aceptadaEn, 300);

  it('dura lo que dice el TTL', () => {
    expect(vence.toISOString()).toBe('2026-03-01T20:05:00.000Z');
  });

  it('el comprador puede pagar mientras corre', () => {
    const session = makeSession({ status: 'reserved', reservedUntil: vence });
    const faltaUnMinuto = new Date(vence.getTime() - 60_000);

    expect(canCheckoutBid(session, faltaUnMinuto)).toBe(true);
    expect(reservationSecondsLeft(session, faltaUnMinuto)).toBe(60);
  });

  it('vencida, ya no puede', () => {
    const session = makeSession({ status: 'reserved', reservedUntil: vence });
    const tarde = new Date(vence.getTime() + 1_000);

    expect(isReservationExpired(session, tarde)).toBe(true);
    expect(canCheckoutBid(session, tarde)).toBe(false);
    expect(reservationSecondsLeft(session, tarde)).toBe(0);
  });

  it('un pedido creado vuelve irrelevante el reloj de la puja', () => {
    // A partir del pedido, las unidades las gobierna el pedido. Sin esta
    // regla, un pago aprobado sobre el minuto seis devolvería a la góndola
    // stock que ya se vendió.
    const conPedido = makeSession({
      status: 'reserved',
      reservedUntil: vence,
      orderId: asOrderId('ord-1'),
    });
    const tarde = new Date(vence.getTime() + 600_000);

    expect(isReservationExpired(conPedido, tarde)).toBe(false);
  });

  it('una sesión que no está reservada no tiene reserva que vencer', () => {
    for (const status of ['open', 'expired', 'sold', 'closed'] as const) {
      const session = makeSession({ status, reservedUntil: vence });
      expect(isReservationExpired(session, new Date(vence.getTime() + 1_000))).toBe(false);
    }
  });
});
