import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  assertIdempotencyKey,
  assertSameRequest,
  fingerprintRequest,
  idempotencyScope,
  isValidIdempotencyKey,
} from './idempotency';

describe('key validation', () => {
  it('accepts the shapes clients actually generate', () => {
    expect(isValidIdempotencyKey('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isValidIdempotencyKey('chk-plaza-moda-campera-roma-v1-1-r3')).toBe(true);
    expect(isValidIdempotencyKey('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
  });

  it('rejects keys too short to be unique or too long to store', () => {
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false);
    expect(isValidIdempotencyKey('espacios no van')).toBe(false);
    expect(isValidIdempotencyKey('')).toBe(false);
  });

  it('throws a typed error rather than a bare string', () => {
    expect(() => assertIdempotencyKey('nope')).toThrow(DomainError);
    try {
      assertIdempotencyKey('nope');
    } catch (error) {
      expect((error as DomainError).code).toBe('INVALID_IDEMPOTENCY_KEY');
    }
  });

  it('trims surrounding whitespace a header may carry', () => {
    expect(assertIdempotencyKey('  valid-key-12345  ')).toBe('valid-key-12345');
  });
});

describe('scoping', () => {
  it('separates operations and actors so keys cannot collide', () => {
    expect(idempotencyScope('checkout.create-order', 'ana')).not.toBe(
      idempotencyScope('checkout.create-order', 'martina'),
    );
    expect(idempotencyScope('checkout.create-order', 'ana')).not.toBe(
      idempotencyScope('payments.refund', 'ana'),
    );
  });
});

describe('request fingerprinting', () => {
  it('is stable for the same payload', () => {
    const payload = { a: 1, b: 'dos', c: [1, 2, 3] };
    expect(fingerprintRequest(payload)).toBe(fingerprintRequest(payload));
  });

  it('ignores property order, which a retry may reserialise differently', () => {
    expect(fingerprintRequest({ a: 1, b: 2, nested: { x: 1, y: 2 } })).toBe(
      fingerprintRequest({ nested: { y: 2, x: 1 }, b: 2, a: 1 }),
    );
  });

  it('treats an omitted optional field the same as an explicit undefined', () => {
    expect(fingerprintRequest({ a: 1, note: undefined })).toBe(fingerprintRequest({ a: 1 }));
  });

  it('distinguishes payloads that differ in a way that matters', () => {
    expect(fingerprintRequest({ quantity: 1 })).not.toBe(fingerprintRequest({ quantity: 2 }));
    expect(fingerprintRequest({ a: '1' })).not.toBe(fingerprintRequest({ a: 1 }));
    expect(fingerprintRequest({ a: null })).not.toBe(fingerprintRequest({ a: 0 }));
  });

  it('respects array order, because line order is meaningful', () => {
    expect(fingerprintRequest([1, 2])).not.toBe(fingerprintRequest([2, 1]));
  });

  it('handles the real checkout payload shape', () => {
    const request = {
      lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
      deliveryMethodId: 'uy-pickup',
      paymentMethodId: 'uy-mercadopago',
      installments: 1,
      address: null,
      buyerNote: null,
      liveSessionId: null,
    };
    const reordered = {
      liveSessionId: null,
      buyerNote: null,
      address: null,
      installments: 1,
      paymentMethodId: 'uy-mercadopago',
      deliveryMethodId: 'uy-pickup',
      lines: [{ quantity: 2, variantId: 'v1', productId: 'p1' }],
    };

    expect(fingerprintRequest(request)).toBe(fingerprintRequest(reordered));
  });
});

describe('conflict detection', () => {
  it('passes when the replay carries the same request', () => {
    const hash = fingerprintRequest({ quantity: 1 });
    expect(() => assertSameRequest(hash, hash, 'key-12345678')).not.toThrow();
  });

  it('raises IDEMPOTENCY_CONFLICT when the payload changed', () => {
    const stored = fingerprintRequest({ quantity: 1 });
    const incoming = fingerprintRequest({ quantity: 9 });

    try {
      assertSameRequest(stored, incoming, 'key-12345678');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as DomainError).code).toBe('IDEMPOTENCY_CONFLICT');
    }
  });

  it('never puts the whole key in the error details', () => {
    try {
      assertSameRequest('a', 'b', 'super-secret-key-value-that-is-long');
    } catch (error) {
      expect(String((error as DomainError).details.key).length).toBeLessThanOrEqual(16);
    }
  });
});
