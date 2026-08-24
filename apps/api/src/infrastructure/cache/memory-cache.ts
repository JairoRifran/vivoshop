import { Injectable } from '@nestjs/common';
import type { CacheStore } from '../../application/ports/infrastructure';

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * Single-process cache. Correct for local development and for a single API
 * instance; the moment there is more than one, `CACHE_DRIVER=redis` takes over
 * without any call site changing.
 */
@Injectable()
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + by;
    await this.set(key, next, ttlSeconds);
    return next;
  }
}
