import { DomainError } from '../errors';

/**
 * Idempotency for commerce operations.
 *
 * This lives in the domain, not next to a payment provider, because the
 * problem is ours before it is anyone's: a double tap, a browser retry, or a
 * flaky mobile connection can each submit the same order twice. That Mercado
 * Pago will later replay webhooks is a second consumer of the same rule, not
 * the reason for it.
 *
 * The guarantee: for one identity and one operation, a key may produce exactly
 * one effect. Replaying it returns the original result; replaying it with a
 * materially different payload is an error, never a silent overwrite.
 */

/** Max length keeps the storage key bounded; UUIDs and ULIDs both fit. */
const KEY_PATTERN = /^[A-Za-z0-9_:.-]{8,128}$/;

export function assertIdempotencyKey(key: string): string {
  const trimmed = key.trim();
  if (!KEY_PATTERN.test(trimmed)) {
    throw new DomainError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must be 8-128 characters of [A-Za-z0-9_:.-]',
      { key: trimmed.slice(0, 16) },
    );
  }
  return trimmed;
}

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key.trim());
}

/**
 * Scoping the key by operation and actor means two different endpoints, or two
 * different people, can never collide on the same key.
 */
export function idempotencyScope(operation: string, actorId: string): string {
  return `${operation}:${actorId}`;
}

/**
 * Stable fingerprint of a request payload.
 *
 * Object key order must not change the result — a client that serialises its
 * body differently on retry is still sending the same request — so keys are
 * sorted at every level before hashing. FNV-1a over the canonical form: not
 * cryptographic, and it does not need to be. It only has to detect that two
 * payloads differ, and a collision here would require an adversary who already
 * knows the victim's key.
 */
export function fingerprintRequest(payload: unknown): string {
  const canonical = canonicalize(payload);

  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  // Length is mixed in so two payloads that hash alike but differ in size
  // still produce different fingerprints.
  return `${hash.toString(16).padStart(8, '0')}-${canonical.length.toString(16)}`;
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // Undefined and absent must be indistinguishable: a client that omits an
      // optional field on retry is not sending a different request.
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(',')}}`;
  }

  /* c8 ignore next */
  return JSON.stringify(String(value));
}

export function assertSameRequest(stored: string, incoming: string, key: string): void {
  if (stored !== incoming) {
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'This idempotency key was already used with a different request',
      { key: key.slice(0, 16) },
    );
  }
}
