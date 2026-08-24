import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool, type PoolConfig } from 'pg';
import { schema } from './schema';

/**
 * Typed against the driver-agnostic base rather than `NodePgDatabase`, so the
 * same repositories run against node-postgres in production and against an
 * in-process PGlite instance in the integration tests. Identical SQL, no
 * separate test doubles.
 */
export type VivoDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DRIZZLE = Symbol('DrizzleDatabase');

/**
 * A single pool per process. `max` is deliberately modest: a live commerce API
 * spends most of its time on short reads, and an oversized pool just moves
 * contention from the app to Postgres.
 */
export interface DatabaseTls {
  readonly mode: 'auto' | 'require' | 'no-verify' | 'disable';
  readonly caCert?: string | undefined;
}

export function createDatabase(
  connectionString: string,
  tls: DatabaseTls = { mode: 'auto' },
): { db: VivoDatabase; pool: Pool } {
  const config: PoolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  const ssl = resolveSsl(connectionString, tls);
  if (ssl !== undefined) config.ssl = ssl;

  const pool = new Pool(config);
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Decides how to talk TLS to Postgres.
 *
 * `node-postgres` does not turn TLS on just because the URL says
 * `sslmode=require`, and a managed database will simply refuse the
 * connection — or worse, accept it in plaintext. So the decision is made here,
 * explicitly, instead of hoping the connection string is interpreted the way
 * someone expected.
 */
function resolveSsl(
  connectionString: string,
  tls: DatabaseTls,
): PoolConfig['ssl'] | undefined {
  if (tls.mode === 'disable') return undefined;

  // A CA always wins: it is the only option that both encrypts and proves who
  // is on the other end.
  if (tls.caCert) return { ca: tls.caCert, rejectUnauthorized: true };

  if (tls.mode === 'no-verify') return { rejectUnauthorized: false };
  if (tls.mode === 'require') return { rejectUnauthorized: true };

  // auto: local development is plaintext, everything else is verified TLS.
  return isLocal(connectionString) ? undefined : { rejectUnauthorized: true };
}

function isLocal(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
  } catch {
    return false;
  }
}
