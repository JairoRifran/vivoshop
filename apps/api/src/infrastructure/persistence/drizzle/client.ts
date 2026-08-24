import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Exported so every script that opens its own pool — the migrator, the seed,
 * the smoke test — negotiates TLS the same way the running API does. When they
 * each built their own config, the smoke test failed against a managed
 * database while the API connected fine.
 */
export function buildPoolConfig(
  connectionString: string,
  tls: DatabaseTls = { mode: 'auto' },
): PoolConfig {
  const config: PoolConfig = {
    connectionString: withoutSslParams(connectionString),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  const ssl = resolveSsl(connectionString, tls);
  if (ssl !== undefined) config.ssl = ssl;

  return config;
}

export function createDatabase(
  connectionString: string,
  tls: DatabaseTls = { mode: 'auto' },
): { db: VivoDatabase; pool: Pool } {
  const pool = new Pool(buildPoolConfig(connectionString, tls));
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
  const ca = readCaCert(tls.caCert);
  if (ca) return { ca, rejectUnauthorized: true };

  if (tls.mode === 'no-verify') return { rejectUnauthorized: false };
  if (tls.mode === 'require') return { rejectUnauthorized: true };

  // auto: local development is plaintext, everything else is verified TLS.
  return isLocal(connectionString) ? undefined : { rejectUnauthorized: true };
}

/**
 * Drops `sslmode` and friends from the connection string.
 *
 * `pg` parses those parameters and builds its own `ssl` object from them,
 * which then **overrides** the one passed alongside. The effect is silent and
 * confusing: a URL ending in `?sslmode=require` makes `DATABASE_SSL` and
 * `DATABASE_CA_CERT` do nothing at all, and the connection keeps failing with
 * `self-signed certificate in certificate chain` no matter what is set.
 *
 * Managed providers hand out URLs with `sslmode` baked in, so this is the
 * normal case, not an edge one. TLS is decided in `resolveSsl` and nowhere
 * else.
 */
function withoutSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of ['sslmode', 'ssl', 'sslrootcert', 'uselibpqcompat']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    // Not a URL we can parse — hand it back untouched rather than guess.
    return connectionString;
  }
}

/** Accepts the PEM itself, a path to it, or a PEM with escaped newlines. */
function readCaCert(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // Env vars in a dashboard often arrive with the newlines escaped.
  if (trimmed.includes('BEGIN CERTIFICATE')) return trimmed.replace(/\\n/g, '\n');

  // A path. Relative ones resolve from the working directory, which for the
  // API is `apps/api` both in development and inside the container.
  return existsSync(trimmed) ? readFileSync(trimmed, 'utf8') : undefined;
}

function isLocal(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
  } catch {
    return false;
  }
}
