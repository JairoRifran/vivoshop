const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Human-readable order reference derived deterministically from the order id.
 * Ambiguous characters (0/O, 1/I) are excluded so it can be read out loud over
 * the phone. Pure by design: the domain never generates randomness itself.
 */
export function buildOrderCode(seed: string, prefix = 'VV'): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  let code = '';
  let value = hash;
  for (let index = 0; index < 5; index += 1) {
    code += ALPHABET.charAt(value % ALPHABET.length);
    value = Math.floor(value / ALPHABET.length);
  }

  return `${prefix}-${code}`;
}
