import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { LiveSessionId } from '@vivo/domain';
import Redis from 'ioredis';
import type { CacheStore, PresenceStore } from '../../application/ports/infrastructure';
import { type AppEnv } from '../../config/env';

export const REDIS_CLIENT = Symbol('RedisClient');

export function createRedisClient(env: AppEnv): Redis {
  const client = new Redis(env.REDIS_URL as string, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // A cache outage must degrade the product, never take it down.
    enableOfflineQueue: false,
  });
  client.on('error', (error: Error) => {
    new Logger('Redis').warn(`Redis unavailable: ${error.message}`);
  });
  return client;
}

@Injectable()
export class RedisCacheStore implements CacheStore, OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.redis.set(key, payload, 'EX', ttlSeconds);
    else await this.redis.set(key, payload);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    const next = await this.redis.incrby(key, by);
    if (ttlSeconds && next === by) await this.redis.expire(key, ttlSeconds);
    return next;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * Presence across more than one API process.
 *
 * A sorted set per session scored by expiry gives both properties the product
 * needs in one structure: entries older than the TTL are pruned by score, so a
 * phone that vanished into a tunnel stops counting, and members are
 * `identity::connection` so distinct people can be counted without counting
 * sockets.
 */
@Injectable()
export class RedisPresenceStore implements PresenceStore {
  private static readonly TTL_SECONDS = 90;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private connectionsKey(sessionId: LiveSessionId): string {
    return `live:${String(sessionId)}:conn`;
  }

  private likesKey(sessionId: LiveSessionId): string {
    return `live:${String(sessionId)}:likes`;
  }

  private member(identityKey: string, connectionKey: string): string {
    return `${identityKey}::${connectionKey}`;
  }

  async join(
    sessionId: LiveSessionId,
    connectionKey: string,
    identityKey: string = connectionKey,
  ): Promise<number> {
    const key = this.connectionsKey(sessionId);
    await this.redis.zadd(key, String(this.expiry()), this.member(identityKey, connectionKey));
    // The key itself expires well after any live member, so an abandoned
    // session leaves nothing behind.
    await this.redis.expire(key, RedisPresenceStore.TTL_SECONDS * 4);
    return this.count(sessionId);
  }

  async touch(sessionId: LiveSessionId, connectionKey: string): Promise<void> {
    const key = this.connectionsKey(sessionId);
    const members = await this.redis.zrange(key, '0', '-1');
    const match = members.find((member) => member.endsWith(`::${connectionKey}`));
    if (match) await this.redis.zadd(key, String(this.expiry()), match);
  }

  async leave(sessionId: LiveSessionId, connectionKey: string): Promise<number> {
    const key = this.connectionsKey(sessionId);
    const members = await this.redis.zrange(key, '0', '-1');
    const match = members.find((member) => member.endsWith(`::${connectionKey}`));
    if (match) await this.redis.zrem(key, match);
    return this.count(sessionId);
  }

  async count(sessionId: LiveSessionId): Promise<number> {
    const key = this.connectionsKey(sessionId);
    // Prune expired entries first, then count distinct identities.
    await this.redis.zremrangebyscore(key, '0', String(Date.now()));
    const members = await this.redis.zrange(key, '0', '-1');
    return new Set(members.map((member) => member.split('::')[0])).size;
  }

  async addLikes(sessionId: LiveSessionId, count: number): Promise<number> {
    return this.redis.incrby(this.likesKey(sessionId), count);
  }

  async likes(sessionId: LiveSessionId): Promise<number> {
    const value = await this.redis.get(this.likesKey(sessionId));
    return value ? Number(value) : 0;
  }

  private expiry(): number {
    return Date.now() + RedisPresenceStore.TTL_SECONDS * 1000;
  }
}
