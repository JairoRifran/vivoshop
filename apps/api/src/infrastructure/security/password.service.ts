import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * scrypt from Node's standard library. No native module to compile, no
 * dependency to audit, and it is a memory-hard KDF, which is what matters.
 *
 * Stored format: `scrypt$<N>$<saltHex>$<hashHex>`. The parameter lives inside
 * the string so existing hashes stay verifiable after the cost is raised.
 */
@Injectable()
export class PasswordService {
  private static readonly KEY_LENGTH = 64;
  private static readonly SALT_LENGTH = 16;

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(PasswordService.SALT_LENGTH);
    const derived = await scryptAsync(plain, salt, PasswordService.KEY_LENGTH);
    return `scrypt$${PasswordService.KEY_LENGTH}$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

    const keyLength = Number(parts[1]);
    const saltHex = parts[2];
    const hashHex = parts[3];
    if (!Number.isInteger(keyLength) || !saltHex || !hashHex) return false;

    const expected = Buffer.from(hashHex, 'hex');
    const derived = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), keyLength);

    // Length check first: timingSafeEqual throws on a mismatch.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }
}
