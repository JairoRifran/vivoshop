import { DomainError } from '../errors';

/**
 * Cuántas ofertas puede mandar una persona.
 *
 * El número no es arbitrario, así que va el razonamiento en vez de la
 * constante sola. Pujar no se parece a chatear: en una puja disputada dos
 * personas se suben el precio varias veces seguidas, y eso es exactamente el
 * comportamiento que el producto quiere. Cortarlo sería romper la función.
 *
 * Lo que sí hay que frenar es el guión que manda mil ofertas de un peso más
 * para tapar la pantalla y empujar el precio. La diferencia entre una persona
 * disputando y un guión no es la ráfaga: es el ritmo sostenido. Así que el
 * balde permite una ráfaga generosa y después limita el sostenido, igual que
 * el chat pero con otros números.
 *
 * `BID_BURST` ofertas disponibles de una, reponiendo `BID_REFILL_PER_SECOND`.
 * Diez seguidas cubren cualquier puja real; una cada tres segundos sostenido
 * hace que inundar la sesión no sirva de nada.
 */
export const BID_BURST = 10;
export const BID_REFILL_PER_SECOND = 1 / 3;

export interface BidBucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

export function newBidBucket(now: number): BidBucket {
  return { tokens: BID_BURST, updatedAt: now };
}

export interface BidAllowance {
  readonly allowed: boolean;
  readonly bucket: BidBucket;
  /** Segundos hasta que haya una oferta más disponible. Cero cuando se permite. */
  readonly retryAfterSeconds: number;
}

export function consumeBidToken(
  bucket: BidBucket,
  now: number,
  burst: number = BID_BURST,
  refillPerSecond: number = BID_REFILL_PER_SECOND,
): BidAllowance {
  const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
  const refilled = Math.min(burst, bucket.tokens + elapsedSeconds * refillPerSecond);

  if (refilled < 1) {
    return {
      allowed: false,
      bucket: { tokens: refilled, updatedAt: now },
      retryAfterSeconds: Math.ceil((1 - refilled) / refillPerSecond),
    };
  }

  return {
    allowed: true,
    bucket: { tokens: refilled - 1, updatedAt: now },
    retryAfterSeconds: 0,
  };
}

export function bidRateLimitError(retryAfterSeconds: number): DomainError {
  return new DomainError('RATE_LIMITED', 'Too many bids', { retryAfterSeconds });
}
