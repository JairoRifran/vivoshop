import { Injectable, Optional } from '@nestjs/common';
import type { LiveSessionId } from '@vivo/domain';
import type { PresenceStore } from '../../application/ports/infrastructure';

/**
 * Live presence, counted by person rather than by socket.
 *
 * Two rules shape this:
 *
 *  - **One person, one viewer.** Someone with the live open in two tabs, or who
 *    reconnects after a tunnel, is one person watching. Counting sockets would
 *    inflate the number the seller sees and the number buyers use as a social
 *    signal. Connections are therefore keyed by connection but *counted* by
 *    identity.
 *  - **Ghosts expire.** A phone that goes into a tunnel never sends a
 *    disconnect. Without a TTL the count only ever goes up, which is worse than
 *    slightly stale: it is a number nobody can trust.
 *
 * This is presence, not accounting. Being briefly off by one is fine; being
 * permanently wrong is not.
 */
const DEFAULT_TTL_SECONDS = 90;

interface Connection {
  readonly identity: string;
  expiresAt: number;
}

@Injectable()
export class MemoryPresenceStore implements PresenceStore {
  private readonly sessions = new Map<string, Map<string, Connection>>();
  private readonly hearts = new Map<string, number>();

  // `@Optional` so the container leaves it alone: the TTL is a tuning knob for
  // tests, not something Nest should try to resolve as a dependency.
  constructor(@Optional() private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS) {}

  async join(
    sessionId: LiveSessionId,
    connectionKey: string,
    identityKey: string = connectionKey,
  ): Promise<number> {
    const key = String(sessionId);
    const connections = this.sessions.get(key) ?? new Map<string, Connection>();
    connections.set(connectionKey, {
      identity: identityKey,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
    });
    this.sessions.set(key, connections);
    return this.count(sessionId);
  }

  /** Called by the client heartbeat so a long watch does not expire. */
  async touch(sessionId: LiveSessionId, connectionKey: string): Promise<void> {
    const connection = this.sessions.get(String(sessionId))?.get(connectionKey);
    if (connection) connection.expiresAt = Date.now() + this.ttlSeconds * 1000;
  }

  async leave(sessionId: LiveSessionId, connectionKey: string): Promise<number> {
    this.sessions.get(String(sessionId))?.delete(connectionKey);
    return this.count(sessionId);
  }

  async count(sessionId: LiveSessionId): Promise<number> {
    const connections = this.prune(String(sessionId));
    return new Set([...connections.values()].map((connection) => connection.identity)).size;
  }

  async addLikes(sessionId: LiveSessionId, count: number): Promise<number> {
    const key = String(sessionId);
    const next = (this.hearts.get(key) ?? 0) + count;
    this.hearts.set(key, next);
    return next;
  }

  async likes(sessionId: LiveSessionId): Promise<number> {
    return this.hearts.get(String(sessionId)) ?? 0;
  }

  /** Swept lazily on read: no background timer to leak in tests. */
  private prune(key: string): Map<string, Connection> {
    const connections = this.sessions.get(key);
    if (!connections) return new Map();

    const now = Date.now();
    for (const [connectionKey, connection] of connections) {
      if (connection.expiresAt <= now) connections.delete(connectionKey);
    }
    if (connections.size === 0) this.sessions.delete(key);
    return connections;
  }
}
