import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMarket } from '@vivo/config';
import { asProductId, asStoreId, asUserId, asVariantId } from '@vivo/domain';
import { and, eq, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CheckoutService } from '../../../application/services/checkout.service';
import type { LiveService } from '../../../application/services/live.service';
import { NoopRealtimePublisher } from '../../realtime/realtime.module';
import type { StoreService } from '../../../application/services/store.service';
import { MockPaymentProvider } from '../../providers/mock-payment.provider';
import { SystemClock, UuidGenerator } from '../../system';
import type { VivoDatabase } from './client';
import { DrizzleOrderTransactionRunner } from './drizzle.order-transaction';
import { DrizzleOrderRepository, DrizzleProductRepository } from './drizzle.repositories';
import { toStore } from './mappers';
import { schema } from './schema';
import { seedDatabase } from './seed';

/* c8 ignore start -- operational script, exercised by `pnpm db:smoke`. */

/**
 * Smoke test against a real PostgreSQL server.
 *
 *   DATABASE_URL=postgresql://... pnpm db:smoke
 *
 * PGlite proves the SQL is correct, but it runs one backend in-process, so it
 * cannot prove that two *connections* racing for the last unit are serialised
 * by row locks. That needs a real server, and this is the script that asks it.
 *
 * Everything happens inside a throwaway schema named `vivo_smoke_<timestamp>`,
 * which is dropped at the end — including on failure. No existing table is
 * read or written, so it is safe against a staging database. It still refuses
 * to run against anything that looks like production.
 *
 * Exits non-zero if any check fails.
 */

const CHECKS: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail = ''): void {
  CHECKS.push({ name, ok, detail });
  const mark = ok ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assertNotProduction(url: string): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SMOKE !== 'yes') {
    throw new Error('Refusing to run the smoke test with NODE_ENV=production.');
  }
  const looksProduction = /prod|production/i.test(url);
  if (looksProduction && process.env.ALLOW_PRODUCTION_SMOKE !== 'yes') {
    throw new Error(
      'DATABASE_URL looks like a production database. Set ALLOW_PRODUCTION_SMOKE=yes to override.',
    );
  }
}

/**
 * Reads the checked-in migrations and retargets them at the throwaway schema.
 *
 * Unqualified names follow `search_path`, but drizzle-kit writes foreign keys
 * as `"public"."users"`, so those are rewritten. This is the one place the
 * script deviates from what `pnpm db:migrate` runs, and it is what keeps the
 * test from touching anything that already exists in the database.
 */
function migrationStatements(schemaName: string): string[] {
  const folder = resolve(__dirname, '../../../../drizzle');
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return files.flatMap((file) =>
    readFileSync(resolve(folder, file), 'utf8')
      .replaceAll('"public".', `"${schemaName}".`)
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}

/** Narrow stub: order creation reads the store inside the transaction. */
function storeServiceFor(db: VivoDatabase): StoreService {
  return {
    requireById: async (id: unknown) => {
      const [row] = await db
        .select()
        .from(schema.stores)
        .where(eq(schema.stores.id, String(id)))
        .limit(1);
      return row ? toStore(row) : null;
    },
  } as unknown as StoreService;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required. Example: DATABASE_URL=postgresql://... pnpm db:smoke');
  assertNotProduction(url);

  const schemaName = `vivo_smoke_${Date.now()}`;
  console.log(`\nPostgreSQL smoke test · schema ${schemaName}\n`);

  // A pool, not a single client: the concurrency check needs real parallel
  // connections, which is the whole reason this script exists.
  const pool = new Pool({ connectionString: url, max: 8 });

  try {
    // --- 1. Connectivity ---------------------------------------------------
    const version = await pool.query<{ version: string }>('select version()');
    record('conectividad', true, version.rows[0]?.version.split(',')[0] ?? 'ok');

    await pool.query(`create schema "${schemaName}"`);
    // Every connection in the pool lands in the throwaway schema.
    pool.on('connect', (client) => {
      void client.query(`set search_path to "${schemaName}"`);
    });
    await pool.query(`set search_path to "${schemaName}"`);

    // --- 2. Migrations -----------------------------------------------------
    const statements = migrationStatements(schemaName);
    const client = await pool.connect();
    try {
      await client.query(`set search_path to "${schemaName}"`);
      for (const statement of statements) await client.query(statement);
    } finally {
      client.release();
    }

    const tables = await pool.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables where table_schema = $1`,
      [schemaName],
    );
    const tableCount = Number(tables.rows[0]?.count ?? 0);
    record('migraciones aplicadas', tableCount >= 12, `${tableCount} tablas`);

    const db = drizzle(pool, { schema }) as unknown as VivoDatabase;

    // --- 3. Isolated fixtures ------------------------------------------------
    await seedDatabase(db);
    const seeded = await pool.query<{ count: string }>('select count(*)::text as count from products');
    record('datos de prueba aislados', Number(seeded.rows[0]?.count ?? 0) > 0, `${seeded.rows[0]?.count} productos`);

    const products = new DrizzleProductRepository(db);
    const orders = new DrizzleOrderRepository(db);
    const runner = new DrizzleOrderTransactionRunner(db);
    const checkout = new CheckoutService(
      products,
      orders,
      runner,
      new MockPaymentProvider(new UuidGenerator()),
      new NoopRealtimePublisher(),
      new SystemClock(),
      new UuidGenerator(),
      storeServiceFor(db),
      liveServiceStub(),
    );

    const BUYER = asUserId('ana');
    const STORE = asStoreId('plaza-moda');
    const PRODUCT = 'campera-roma';
    const VARIANT = 'campera-roma-v1';

    const request = (quantity = 1) => ({
      lines: [{ productId: PRODUCT, variantId: VARIANT, quantity }],
      deliveryMethodId: 'uy-pickup',
      paymentMethodId: 'uy-mercadopago',
      installments: 1,
      address: null,
      buyerNote: null,
      liveSessionId: null,
    });

    const setStock = async (value: number) =>
      pool.query('update product_variants set stock = $1 where id = $2', [value, VARIANT]);
    const readStock = async (): Promise<number> => {
      const result = await pool.query<{ stock: number }>(
        'select stock from product_variants where id = $1',
        [VARIANT],
      );
      return Number(result.rows[0]?.stock ?? -1);
    };
    const countOrders = async (): Promise<number> => {
      const result = await pool.query<{ count: string }>('select count(*)::text as count from orders');
      return Number(result.rows[0]?.count ?? 0);
    };

    // --- 4. Transaction boundary -----------------------------------------------
    await setStock(4);
    const ordersBeforeRollback = await countOrders();
    let rolledBack = false;
    try {
      await runner.run(async (tx) => {
        const reserved = await tx.reserveStock([
          {
            productId: asProductId(PRODUCT),
            variantId: asVariantId(VARIANT),
            quantity: 3,
          },
        ]);
        if (!reserved.ok) throw new Error('unexpected shortfall');
        // Abort after the decrement: the rollback must undo it.
        throw new Error('deliberate rollback');
      });
    } catch {
      rolledBack = true;
    }
    const stockAfterRollback = await readStock();
    record(
      'transacción: ROLLBACK deja el stock intacto',
      rolledBack && stockAfterRollback === 4 && (await countOrders()) === ordersBeforeRollback,
      `stock ${stockAfterRollback}/4`,
    );

    // --- 5. Concurrent stock across real connections -------------------------------
    await setStock(1);
    const ordersBeforeRace = await countOrders();
    const race = await Promise.allSettled([
      checkout.createOrder(BUYER, STORE, request(), `smoke-race-a-${Date.now()}`),
      checkout.createOrder(BUYER, STORE, request(), `smoke-race-b-${Date.now()}`),
    ]);
    const won = race.filter((result) => result.status === 'fulfilled').length;
    const lost = race.filter((result) => result.status === 'rejected').length;
    const stockAfterRace = await readStock();
    record(
      'concurrencia: 2 compradores, 1 unidad',
      won === 1 && lost === 1 && stockAfterRace === 0 && (await countOrders()) === ordersBeforeRace + 1,
      `${won} exitosa / ${lost} OUT_OF_STOCK / stock ${stockAfterRace}`,
    );

    await setStock(3);
    const ordersBeforeBurst = await countOrders();
    const burst = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        checkout.createOrder(BUYER, STORE, request(), `smoke-burst-${index}-${Date.now()}`),
      ),
    );
    const burstWon = burst.filter((result) => result.status === 'fulfilled').length;
    const stockAfterBurst = await readStock();
    record(
      'concurrencia: 5 compradores, 3 unidades',
      burstWon === 3 &&
        stockAfterBurst === 0 &&
        (await countOrders()) === ordersBeforeBurst + 3,
      `${burstWon} exitosas / stock ${stockAfterBurst}`,
    );

    // --- 6. Idempotency across real connections -------------------------------------
    await setStock(5);
    const key = `smoke-idem-${Date.now()}`;
    const ordersBeforeIdem = await countOrders();
    const replayed = await Promise.allSettled([
      checkout.createOrder(BUYER, STORE, request(), key),
      checkout.createOrder(BUYER, STORE, request(), key),
    ]);
    const ids = new Set(
      replayed
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id),
    );
    record(
      'idempotencia: misma clave en paralelo crea un solo pedido',
      ids.size === 1 && (await countOrders()) === ordersBeforeIdem + 1 && (await readStock()) === 4,
      `${ids.size} pedido(s)`,
    );

    let conflicted = false;
    try {
      await checkout.createOrder(BUYER, STORE, request(2), key);
    } catch (error) {
      conflicted = JSON.stringify(error instanceof Error ? error.message : error).length > 0;
      const code = (error as { response?: { code?: string } })?.response?.code;
      conflicted = code === 'IDEMPOTENCY_CONFLICT';
    }
    record('idempotencia: misma clave + payload distinto → conflicto', conflicted);

    // --- 7. The atomic predicate itself ------------------------------------------------
    await setStock(1);
    const overshoot = await db
      .update(schema.productVariants)
      .set({ stock: sql`${schema.productVariants.stock} - 5` })
      .where(
        and(
          eq(schema.productVariants.id, VARIANT),
          gte(schema.productVariants.stock, 5),
        ),
      )
      .returning({ stock: schema.productVariants.stock });
    record(
      'UPDATE condicional no toca filas cuando falta stock',
      overshoot.length === 0 && (await readStock()) === 1,
    );

    // --- 8. Tax snapshot round trip -------------------------------------------------------
    await setStock(5);
    const order = await checkout.createOrder(BUYER, STORE, request(), `smoke-tax-${Date.now()}`);
    const market = getMarket('UY');
    record(
      'snapshot de impuestos persistido',
      order.tax.rateBps === market.tax.rules.standard?.rateBps &&
        order.items.every((item) => item.taxRateBps > 0),
      `${order.tax.category} ${order.tax.rateBps} bps`,
    );
  } finally {
    // --- 9. Cleanup ------------------------------------------------------------------------
    try {
      await pool.query(`drop schema if exists "${schemaName}" cascade`);
      console.log(`\n  schema ${schemaName} eliminado`);
    } catch (error) {
      console.error(`\n  no se pudo eliminar el schema ${schemaName}:`, error);
    }
    await pool.end().catch(() => undefined);
  }

  const failed = CHECKS.filter((check) => !check.ok);
  console.log(`\n${CHECKS.length - failed.length}/${CHECKS.length} comprobaciones OK\n`);

  if (failed.length > 0) {
    console.error('Fallaron:', failed.map((check) => check.name).join(', '));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('\nSmoke test abortado:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
/* c8 ignore stop */

/**
 * The pieces of `CheckoutService` that have nothing to do with persistence.
 *
 * Realtime and live attribution are fanned out *after* the commit, so neither
 * one can affect what these tests measure. Stubbing them keeps the harness
 * honest about that: if a checkout ever started depending on a socket being
 * connected, this stub would make it fail loudly rather than quietly work.
 */
function liveServiceStub(): LiveService {
  return {
    stats: async () => ({
      liveSessionId: '',
      viewerCount: 0,
      likeCount: 0,
      ordersCount: 0,
      unitsSold: 0,
      revenueMinor: 0,
      currency: 'UYU',
      elapsedSeconds: 0,
    }),
  } as unknown as LiveService;
}
