import type { CurrencyCode } from '@vivo/config';
import { DomainError } from '../errors';
import type {
  BidId,
  BidSessionId,
  LiveSessionId,
  OrderId,
  ProductId,
  StoreId,
  UserId,
  VariantId,
} from '../value-objects/identifiers';

/**
 * Modo Puja.
 *
 * Lo primero que hay que decir es lo que **no** es: no es una subasta. En una
 * subasta el reloj decide, el mayor postor gana solo y el vendedor mira. Acá
 * el vendedor decide, y esa diferencia gobierna todo el archivo:
 *
 * ```
 * vendedor abre la puja
 *   → los compradores ofertan
 *   → todos ven las mejores ofertas en vivo
 *   → el vendedor acepta la que le sirve — o ninguna
 *   → el producto queda reservado para quien ganó
 *   → esa persona paga por el checkout de siempre
 * ```
 *
 * No hay cierre automático por tiempo, y el precio de referencia **no obliga**:
 * un vendedor puede aceptar $1.600 sobre una referencia de $2.000 porque prefiere
 * vender hoy. Nada en este archivo compara la oferta contra la referencia para
 * permitir o impedir una aceptación.
 *
 * La arquitectura queda preparada para subastas cronometradas —los plazos son
 * datos, no `if`s repartidos— pero no se construyen ahora.
 */

// --- Estados de la sesión -----------------------------------------------------

export const BID_SESSION_STATUSES = [
  /** Recibiendo ofertas. */
  'open',
  /** El vendedor aceptó una: hay ganador y el reloj de pago corre. */
  'reserved',
  /** El ganador no pagó a tiempo. El vendedor decide qué hacer. */
  'expired',
  /** Se pagó. */
  'sold',
  /** Terminó sin venta. */
  'closed',
] as const;
export type BidSessionStatus = (typeof BID_SESSION_STATUSES)[number];

/**
 * Transiciones legales.
 *
 * Dos estados que el diseño original contemplaba y no sobrevivieron, con el
 * motivo, porque su ausencia se nota:
 *
 * - **`accepting`** describía el instante entre "el vendedor tocó aceptar" y
 *   "hay ganador". Ese instante es una transacción, no un estado: si se
 *   persistiera, un proceso que muriera en el medio dejaría una sesión trabada
 *   en un estado del que nadie sabe salir. Lo que lo hace seguro es el lock de
 *   `AcceptBid`, no una fila.
 *
 * - **`cancelled`** decía lo mismo que `closed` —terminó sin venta— y se
 *   diferenciaba en *quién* lo hizo. Eso es un motivo, no un estado: como
 *   estado obliga a cada consumidor a recordar que dos valores significan lo
 *   mismo, y tarde o temprano alguien chequea uno y se olvida del otro. Vive
 *   en `closedReason`.
 *
 * `expired` sí es un estado propio: la reserva venció, el stock ya volvió a la
 * góndola, y todavía **no** se decidió si se reabre o se cierra. No es `open`
 * —nadie puede ofertar mientras el vendedor no reabra— ni `closed`.
 */
const BID_SESSION_TRANSITIONS: Record<BidSessionStatus, readonly BidSessionStatus[]> = {
  open: ['reserved', 'closed'],
  reserved: ['sold', 'expired', 'closed'],
  expired: ['open', 'closed'],
  sold: [],
  closed: [],
};

export function canTransitionBidSession(from: BidSessionStatus, to: BidSessionStatus): boolean {
  return BID_SESSION_TRANSITIONS[from].includes(to);
}

export function assertBidSessionTransition(from: BidSessionStatus, to: BidSessionStatus): void {
  if (!canTransitionBidSession(from, to)) {
    throw new DomainError('INVALID_BID_SESSION_TRANSITION', 'Bid session cannot change to that', {
      from,
      to,
    });
  }
}

/** Si la sesión sigue viva para el vendedor, aunque no acepte ofertas. */
export function isBidSessionFinal(status: BidSessionStatus): boolean {
  return BID_SESSION_TRANSITIONS[status].length === 0;
}

export const BID_CLOSE_REASONS = [
  /** El vendedor la cerró a mano. */
  'seller',
  /** Terminó el vivo con la puja abierta. */
  'live_ended',
] as const;
export type BidCloseReason = (typeof BID_CLOSE_REASONS)[number];

// --- Estados de una oferta ------------------------------------------------------

/**
 * Lo que se **guarda** de una oferta. Tres valores, no seis.
 *
 * `outbid` y `lost` no se persisten: se derivan. Superada es "hay otra oferta
 * más alta viva en esta sesión" y perdida es "la sesión terminó y no fue esta".
 * Las dos se calculan mirando lo que ya está guardado, así que escribirlas
 * sería mantener a mano una verdad que la base ya tiene — y cerrar una sesión
 * pasaría de ser una escritura a ser tantas como ofertas haya.
 *
 * `expired` **sí** se guarda, porque no se puede derivar: dice que esta oferta
 * fue aceptada y su ganador no pagó a tiempo. Sin eso, una sesión reabierta
 * seguiría mostrando como aceptada una oferta que ya no vale.
 */
export const BID_STATUSES = ['active', 'accepted', 'expired'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

/** Cómo se le muestra una oferta a quien la hizo. Derivado, nunca guardado. */
export const BID_OUTCOMES = ['leading', 'outbid', 'accepted', 'lost'] as const;
export type BidOutcome = (typeof BID_OUTCOMES)[number];

export interface Bid {
  readonly id: BidId;
  readonly bidSessionId: BidSessionId;
  readonly buyerId: UserId;
  /** Nombre público de quien ofertó, congelado. La puja es un evento social. */
  readonly buyerName: string;
  readonly buyerAvatarUrl: string | null;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly status: BidStatus;
  readonly createdAt: Date;
}

export interface BidSession {
  readonly id: BidSessionId;
  readonly liveSessionId: LiveSessionId;
  readonly storeId: StoreId;
  /** Quien decide. Se guarda para no depender de leer la tienda al aceptar. */
  readonly sellerId: UserId;
  readonly productId: ProductId;
  /**
   * La unidad concreta que se está pujando.
   *
   * El stock vive en la variante, no en el producto, así que sin esto no hay
   * nada que reservar cuando el vendedor acepta. Una sesión puja **una**
   * unidad de **una** variante; ver `BID_UNITS`.
   */
  readonly variantId: VariantId;
  readonly status: BidSessionStatus;
  readonly currency: CurrencyCode;
  /**
   * Lo que el producto vale en la ficha, congelado al abrir.
   *
   * Es información para quien oferta, **no** un piso. El vendedor puede
   * aceptar por debajo, y de hecho es el caso normal: se abre una puja para
   * vender hoy, no para conseguir más que el catálogo.
   */
  readonly referencePriceMinor: number;
  /** Piso opcional. Sin esto, cualquier monto positivo es una oferta válida. */
  readonly minimumBidMinor: number | null;
  /** Salto mínimo sobre la mejor oferta. Opcional. */
  readonly minimumIncrementMinor: number | null;
  /** La oferta que el vendedor aceptó. Una sola, para siempre. */
  readonly acceptedBidId: BidId | null;
  /** Hasta cuándo tiene el ganador para pagar. */
  readonly reservedUntil: Date | null;
  /** El pedido que salió de esta puja, cuando el ganador llegó al checkout. */
  readonly orderId: OrderId | null;
  readonly closedReason: BidCloseReason | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
}

/**
 * Cuántas unidades pone en juego una sesión.
 *
 * Una. Es una decisión de alcance y conviene que esté escrita en un solo lugar
 * en vez de repartida como el número 1: pujar veinte unidades a la vez no es
 * "lo mismo pero con más stock", es otro producto —hay que decidir si gana un
 * postor todo o se reparte, qué pasa con los que quedan afuera, y cómo se ve—.
 * Eso es una decisión de producto que todavía no se tomó.
 */
export const BID_UNITS = 1;

// --- Reserva ---------------------------------------------------------------------

/**
 * Cuánto tiene el ganador para pagar.
 *
 * Cinco minutos: alcanza para abrir Mercado Pago, elegir tarjeta y confirmar
 * sin correr, y no tanto como para que el vendedor tenga el producto trabado
 * media hora mientras el vivo sigue. El valor es configurable —vive acá y en
 * `BID_RESERVATION_TTL_SECONDS` del entorno, en ningún otro lado— porque es de
 * los que se ajustan con datos reales, no con opinión.
 */
export const DEFAULT_BID_RESERVATION_SECONDS = 300;

export function reservationDeadline(
  acceptedAt: Date,
  ttlSeconds: number = DEFAULT_BID_RESERVATION_SECONDS,
): Date {
  return new Date(acceptedAt.getTime() + ttlSeconds * 1000);
}

/**
 * Si la reserva ya venció.
 *
 * Un pedido creado la vuelve irrelevante: a partir de ahí las unidades las
 * gobierna el pedido —se liberan si el pago se cae, se consumen si prospera— y
 * que el reloj de la puja siga corriendo no puede volver a tocarlas. Sin esta
 * condición, un pago aprobado sobre el minuto seis devolvería stock que ya se
 * vendió.
 */
export function isReservationExpired(
  session: Pick<BidSession, 'status' | 'reservedUntil' | 'orderId'>,
  now: Date = new Date(),
): boolean {
  if (session.status !== 'reserved' || session.orderId) return false;
  return session.reservedUntil !== null && session.reservedUntil.getTime() <= now.getTime();
}

export function reservationSecondsLeft(
  session: Pick<BidSession, 'reservedUntil'>,
  now: Date = new Date(),
): number {
  if (!session.reservedUntil) return 0;
  return Math.max(0, Math.ceil((session.reservedUntil.getTime() - now.getTime()) / 1000));
}

// --- Quién puede ofertar ----------------------------------------------------------

/**
 * El dueño de la tienda no puede ofertar en su propia puja.
 *
 * Inflar el precio con ofertas propias tiene nombre y es fraude. Se chequea en
 * el dominio y no en un guard para que ninguna ruta nueva se olvide.
 */
export function assertNotOwnBid(session: Pick<BidSession, 'sellerId'>, buyerId: UserId): void {
  if (session.sellerId === buyerId) {
    throw new DomainError('CANNOT_BID_ON_OWN_STORE', 'A seller cannot bid on their own session', {});
  }
}

// --- Validación de una oferta -------------------------------------------------------

/** El monto más bajo que la sesión acepta ahora mismo. */
export function nextMinimumBid(
  session: Pick<BidSession, 'minimumBidMinor' | 'minimumIncrementMinor'>,
  leading: Pick<Bid, 'amountMinor'> | null,
): number {
  if (!leading) return session.minimumBidMinor ?? 1;

  const increment = session.minimumIncrementMinor ?? 1;
  return leading.amountMinor + increment;
}

/**
 * El monto máximo que se acepta.
 *
 * Existe por dos motivos que no son teóricos. Uno: un cero de más en un
 * teléfono convierte $1.300 en $13.000 y nadie quiere descubrirlo al aceptar.
 * Dos: los montos son enteros en unidades menores y hay que quedarse lejos del
 * límite seguro de JavaScript, porque un desbordamiento no falla ruidosamente
 * —devuelve un número equivocado—.
 */
export const MAX_BID_MINOR = 1_000_000_000_00;

/**
 * Valida una oferta contra la sesión y contra la mejor oferta vigente.
 *
 * Todo junto en una función pura para que el servidor y la UI puedan usar la
 * misma regla, y para que el "mínimo siguiente" que se le muestra al comprador
 * salga del mismo lugar que la validación que lo va a rechazar.
 */
export function assertBidAcceptable(input: {
  readonly session: Pick<
    BidSession,
    'status' | 'currency' | 'minimumBidMinor' | 'minimumIncrementMinor'
  >;
  readonly leading: Pick<Bid, 'amountMinor'> | null;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}): void {
  const { session, leading, amountMinor, currency } = input;

  if (session.status !== 'open') {
    throw new DomainError('BID_SESSION_NOT_OPEN', 'The bid session is not taking offers', {
      status: session.status,
    });
  }

  if (currency !== session.currency) {
    throw new DomainError('CURRENCY_MISMATCH', 'Bid currency does not match the session', {
      expected: session.currency,
      received: currency,
    });
  }

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new DomainError('INVALID_BID_AMOUNT', 'A bid must be a positive integer amount', {
      amountMinor,
    });
  }

  if (amountMinor > MAX_BID_MINOR) {
    throw new DomainError('INVALID_BID_AMOUNT', 'Bid amount is out of range', { amountMinor });
  }

  const minimum = nextMinimumBid(session, leading);
  if (amountMinor < minimum) {
    // Un solo código para "muy baja", con el mínimo adentro: al comprador le
    // sirve el número, no si le faltó el piso o el incremento.
    throw new DomainError('BID_TOO_LOW', 'Bid is below the minimum accepted right now', {
      minimumMinor: minimum,
      amountMinor,
    });
  }
}

/**
 * Cuál de las ofertas manda.
 *
 * Empate por monto: gana la primera. Cuando dos personas mandan lo mismo en el
 * mismo segundo, la que llegó antes se lo ganó — cualquier otro criterio sería
 * arbitrario y habría que explicárselo a alguien.
 */
export function leadingBid(bids: readonly Bid[]): Bid | null {
  let best: Bid | null = null;

  for (const bid of bids) {
    if (bid.status === 'expired') continue;
    if (!best) {
      best = bid;
      continue;
    }
    if (bid.amountMinor > best.amountMinor) best = bid;
    else if (bid.amountMinor === best.amountMinor && bid.createdAt < best.createdAt) best = bid;
  }

  return best;
}

/** Cómo se le muestra una oferta a quien la hizo. */
export function bidOutcome(
  bid: Pick<Bid, 'id' | 'status'>,
  session: Pick<BidSession, 'status' | 'acceptedBidId'>,
): BidOutcome {
  if (bid.status === 'accepted') return 'accepted';
  if (session.acceptedBidId && session.acceptedBidId !== bid.id) return 'lost';
  if (isBidSessionFinal(session.status)) return 'lost';
  return bid.status === 'expired' ? 'lost' : 'leading';
}

/**
 * Marca cada oferta con lo que le pasó, comparando contra la mejor.
 *
 * Se hace al leer y no al escribir: es la contracara de no persistir `outbid`.
 */
export function withOutcomes(
  bids: readonly Bid[],
  session: Pick<BidSession, 'status' | 'acceptedBidId'>,
): ReadonlyArray<{ readonly bid: Bid; readonly outcome: BidOutcome }> {
  const leader = leadingBid(bids);

  return bids.map((bid) => {
    const outcome = bidOutcome(bid, session);
    if (outcome === 'leading' && leader && leader.id !== bid.id) {
      return { bid, outcome: 'outbid' as const };
    }
    return { bid, outcome };
  });
}

// --- Aceptar ------------------------------------------------------------------------

/**
 * Si esta oferta se puede aceptar en esta sesión.
 *
 * Las tres condiciones son el corazón de "un solo ganador": la sesión tiene que
 * estar abierta, la oferta tiene que pertenecerle, y tiene que seguir viva. Que
 * se evalúen dentro de la transacción que además toma el lock es lo que hace
 * que dos aceptaciones simultáneas no produzcan dos ganadores.
 */
export function assertCanAccept(
  session: Pick<BidSession, 'id' | 'status'>,
  bid: Pick<Bid, 'bidSessionId' | 'status'>,
): void {
  if (session.status !== 'open') {
    throw new DomainError('BID_SESSION_NOT_OPEN', 'The bid session is no longer taking offers', {
      status: session.status,
    });
  }
  if (String(bid.bidSessionId) !== String(session.id)) {
    throw new DomainError('BID_NOT_IN_SESSION', 'That offer belongs to another session', {});
  }
  if (bid.status !== 'active') {
    throw new DomainError('BID_NOT_ACTIVE', 'That offer can no longer be accepted', {
      status: bid.status,
    });
  }
}

/** Si el comprador todavía puede pagar lo que ganó. */
export function canCheckoutBid(
  session: Pick<BidSession, 'status' | 'reservedUntil' | 'orderId'>,
  now: Date = new Date(),
): boolean {
  if (session.status !== 'reserved') return false;
  return !isReservationExpired(session, now);
}
