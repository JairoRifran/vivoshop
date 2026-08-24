import { DomainError } from '../errors';

/**
 * Chat rate limiting.
 *
 * The numbers are a judgement call, so here is the reasoning rather than a
 * bare constant. During a live, a genuinely engaged buyer sends a short burst
 * — "¿hay talle M?", "¿y en negro?" — and then waits. Someone flooding the
 * chat sends continuously. So the limit allows a burst and then throttles the
 * sustained rate, instead of rejecting the second honest question in a row.
 *
 * A token bucket expresses exactly that: `BURST` messages available at once,
 * refilling at `REFILL_PER_SECOND`. Pure and time-injected, so it is testable
 * without waiting.
 */
export const CHAT_BURST = 5;
export const CHAT_REFILL_PER_SECOND = 0.5; // one message every two seconds, sustained

export interface ChatBucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

export function newChatBucket(now: number): ChatBucket {
  return { tokens: CHAT_BURST, updatedAt: now };
}

export interface ChatAllowance {
  readonly allowed: boolean;
  readonly bucket: ChatBucket;
  /** Seconds until one more message is available. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

export function consumeChatToken(
  bucket: ChatBucket,
  now: number,
  burst: number = CHAT_BURST,
  refillPerSecond: number = CHAT_REFILL_PER_SECOND,
): ChatAllowance {
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

export function chatRateLimitError(retryAfterSeconds: number): DomainError {
  return new DomainError('RATE_LIMITED', 'Too many chat messages', { retryAfterSeconds });
}
