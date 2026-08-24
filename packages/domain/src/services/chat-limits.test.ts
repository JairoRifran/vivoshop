import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  CHAT_BURST,
  CHAT_REFILL_PER_SECOND,
  chatRateLimitError,
  consumeChatToken,
  newChatBucket,
} from './chat-limits';

/**
 * Time is injected, so none of this waits. A rate limiter tested with real
 * sleeps is a slow test that still does not prove the boundary.
 */
const T0 = 1_770_000_000_000;

describe('chat rate limit', () => {
  it('lets an engaged buyer send a full burst without friction', () => {
    let bucket = newChatBucket(T0);

    for (let index = 0; index < CHAT_BURST; index += 1) {
      const allowance = consumeChatToken(bucket, T0);
      expect(allowance.allowed).toBe(true);
      bucket = allowance.bucket;
    }
  });

  it('throttles the message right after the burst', () => {
    let bucket = newChatBucket(T0);
    for (let index = 0; index < CHAT_BURST; index += 1) {
      bucket = consumeChatToken(bucket, T0).bucket;
    }

    const blocked = consumeChatToken(bucket, T0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tells the client when to try again, in whole seconds', () => {
    let bucket = newChatBucket(T0);
    for (let index = 0; index < CHAT_BURST; index += 1) {
      bucket = consumeChatToken(bucket, T0).bucket;
    }

    // Empty bucket refilling at one message every two seconds.
    const blocked = consumeChatToken(bucket, T0);
    expect(blocked.retryAfterSeconds).toBe(Math.ceil(1 / CHAT_REFILL_PER_SECOND));
  });

  it('refills over time and admits the next message', () => {
    let bucket = newChatBucket(T0);
    for (let index = 0; index < CHAT_BURST; index += 1) {
      bucket = consumeChatToken(bucket, T0).bucket;
    }

    const oneTokenMs = (1 / CHAT_REFILL_PER_SECOND) * 1000;
    const justShort = consumeChatToken(bucket, T0 + oneTokenMs - 1);
    expect(justShort.allowed).toBe(false);

    const exactly = consumeChatToken(bucket, T0 + oneTokenMs);
    expect(exactly.allowed).toBe(true);
  });

  it('never refills beyond the burst, however long the silence', () => {
    const bucket = newChatBucket(T0);
    // An hour of not typing does not buy an hour's worth of messages.
    const afterAnHour = consumeChatToken(bucket, T0 + 3_600_000);
    expect(afterAnHour.bucket.tokens).toBe(CHAT_BURST - 1);
  });

  it('is pure: the same bucket and clock always give the same answer', () => {
    const bucket = newChatBucket(T0);
    const first = consumeChatToken(bucket, T0 + 500);
    const second = consumeChatToken(bucket, T0 + 500);
    expect(first).toEqual(second);
  });

  it('carries a stable code and the retry hint into the error', () => {
    const error = chatRateLimitError(2);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.details).toEqual({ retryAfterSeconds: 2 });
  });
});
