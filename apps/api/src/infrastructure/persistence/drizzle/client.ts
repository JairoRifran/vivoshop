import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
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
export function createDatabase(connectionString: string): { db: VivoDatabase; pool: Pool } {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return { db: drizzle(pool, { schema }), pool };
}
