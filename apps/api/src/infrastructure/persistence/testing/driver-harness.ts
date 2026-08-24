import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Order, OrderId, Product, ProductId, StoreId } from '@vivo/domain';
import { asProductId, asStoreId, asUserId } from '@vivo/domain';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { CheckoutService } from '../../../application/services/checkout.service';
import type { LiveService } from '../../../application/services/live.service';
import { NoopRealtimePublisher } from '../../realtime/realtime.module';
import type { OrderTransactionRunner } from '../../../application/ports/order-transaction';
import type { OrderRepository, ProductRepository } from '../../../application/ports/repositories';
import { MockPaymentProvider } from '../../providers/mock-payment.provider';
import { PasswordService } from '../../security/password.service';
import { SystemClock, UuidGenerator } from '../../system';
import type { StoreService } from '../../../application/services/store.service';
import type { VivoDatabase } from '../drizzle/client';
import { DrizzleOrderTransactionRunner } from '../drizzle/drizzle.order-transaction';
import { DrizzleOrderRepository, DrizzleProductRepository } from '../drizzle/drizzle.repositories';
import { toStore } from '../drizzle/mappers';
import { schema } from '../drizzle/schema';
import { seedDatabase } from '../drizzle/seed';
import { MemoryDatabase } from '../memory/memory-database';
import { MemoryOrderTransactionRunner } from '../memory/memory.order-transaction';
import { MemoryOrderRepository, MemoryProductRepository } from '../memory/memory.repositories';

/**
 * One test harness, two persistence drivers.
 *
 * The point is parity. `DATA_DRIVER=memory` is the default development
 * experience, so "it works in Postgres" is not enough — both drivers have to
 * be observably identical about stock, concurrency, idempotency and rollback.
 * Running the same suite against both is the only way to keep that true as the
 * code changes.
 */
/**
 * Injects a failure at a chosen point inside the transaction, so rollback can
 * be tested for real instead of being assumed. Wrapping the runner keeps the
 * tests free of monkey-patching and keeps production code free of test hooks.
 */
export class FaultInjectingRunner implements OrderTransactionRunner {
  /** When true, the next `insertOrder` throws *after* stock was reserved. */
  failOnInsertOrder = false;

  constructor(private readonly inner: OrderTransactionRunner) {}

  async run<T>(work: (tx: never) => Promise<T>): Promise<T> {
    return this.inner.run(async (tx) => {
      if (!this.failOnInsertOrder) return work(tx as never);

      const proxied = {
        ...tx,
        claimIdempotency: tx.claimIdempotency.bind(tx),
        attachIdempotencyResult: tx.attachIdempotencyResult.bind(tx),
        loadStore: tx.loadStore.bind(tx),
        loadProducts: tx.loadProducts.bind(tx),
        reserveStock: tx.reserveStock.bind(tx),
        recordLiveSale: tx.recordLiveSale.bind(tx),
        insertOrder: async () => {
          throw new Error('simulated storage failure');
        },
      };
      return work(proxied as never);
    });
  }
}

export interface DriverHarness {
  readonly name: string;
  readonly checkout: CheckoutService;
  /** Test-only failure injection; see `FaultInjectingRunner`. */
  readonly faults: FaultInjectingRunner;
  readonly products: ProductRepository;
  readonly orders: OrderRepository;
  /** Sets a variant's stock to an exact value, for arranging a scenario. */
  setStock(productId: string, variantId: string, stock: number): Promise<void>;
  readStock(productId: string, variantId: string): Promise<number>;
  countOrders(): Promise<number>;
  /** Frees any resources the driver holds. */
  dispose(): Promise<void>;
}

/** Seed constants the scenarios build on. */
export const BUYER = asUserId('ana');
export const STORE = asStoreId('plaza-moda');
export const PRODUCT = 'campera-roma';
export const VARIANT = 'campera-roma-v1';
export const OTHER_PRODUCT = 'pantalon-cordon';
export const OTHER_VARIANT = 'pantalon-cordon-v1';

const NOW = new Date('2026-03-01T20:00:00.000Z');

/**
 * `CheckoutService` only touches the store service on the preview and payment
 * paths; order creation reads the store inside the transaction. A narrow stub
 * keeps the harness from having to construct half the application graph.
 */
function storeServiceStub(load: (id: StoreId) => Promise<unknown>): StoreService {
  return {
    requireById: async (id: StoreId) => load(id),
  } as unknown as StoreService;
}

function buildCheckout(
  products: ProductRepository,
  orders: OrderRepository,
  runner: OrderTransactionRunner,
  stores: StoreService,
): CheckoutService {
  return new CheckoutService(
    products,
    orders,
    runner,
    new MockPaymentProvider(new UuidGenerator()),
    new NoopRealtimePublisher(),
    new SystemClock(),
    new UuidGenerator(),
    stores,
    liveServiceStub(),
  );
}

// --- Memory ------------------------------------------------------------------

export async function createMemoryHarness(): Promise<DriverHarness> {
  const db = new MemoryDatabase();
  await db.seed((plain) => new PasswordService().hash(plain), { now: NOW });

  const products = new MemoryProductRepository(db);
  const orders = new MemoryOrderRepository(db);
  const faults = new FaultInjectingRunner(new MemoryOrderTransactionRunner(db));
  const stores = storeServiceStub(async (id) => db.stores.get(String(id)));

  return {
    name: 'memory',
    checkout: buildCheckout(products, orders, faults, stores),
    faults,
    products,
    orders,
    async setStock(productId, variantId, stock) {
      const product = db.products.get(productId);
      if (!product) throw new Error(`Unknown product ${productId}`);
      db.products.set(productId, {
        ...product,
        variants: product.variants.map((variant) =>
          String(variant.id) === variantId ? { ...variant, stock } : variant,
        ),
      });
    },
    async readStock(productId, variantId) {
      const product = db.products.get(productId);
      const variant = product?.variants.find((candidate) => String(candidate.id) === variantId);
      if (!variant) throw new Error(`Unknown variant ${variantId}`);
      return variant.stock;
    },
    async countOrders() {
      return db.orders.size;
    },
    async dispose() {
      db.clear();
    },
  };
}

// --- PostgreSQL (PGlite) --------------------------------------------------------

/** Applies the checked-in migrations, exactly as `pnpm db:migrate` would. */
async function applyMigrations(client: PGlite): Promise<void> {
  const folder = resolve(__dirname, '../../../../drizzle');
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(resolve(folder, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.exec(trimmed);
    }
  }
}

export async function createPgliteHarness(): Promise<DriverHarness> {
  const client = new PGlite();
  await applyMigrations(client);

  const db = drizzle(client, { schema }) as unknown as VivoDatabase;
  await seedDatabase(db, { now: NOW });

  const products = new DrizzleProductRepository(db);
  const orders = new DrizzleOrderRepository(db);
  const faults = new FaultInjectingRunner(new DrizzleOrderTransactionRunner(db));
  const stores = storeServiceStub(async (id) => {
    const [row] = await db
      .select()
      .from(schema.stores)
      .where(eq(schema.stores.id, String(id)))
      .limit(1);
    return row ? toStore(row) : null;
  });

  return {
    name: 'postgres (pglite)',
    checkout: buildCheckout(products, orders, faults, stores),
    faults,
    products,
    orders,
    async setStock(_productId, variantId, stock) {
      await client.query('update product_variants set stock = $1 where id = $2', [
        stock,
        variantId,
      ]);
    },
    async readStock(_productId, variantId) {
      const result = await client.query<{ stock: number }>(
        'select stock from product_variants where id = $1',
        [variantId],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Unknown variant ${variantId}`);
      return Number(row.stock);
    },
    async countOrders() {
      const result = await client.query<{ total: string }>('select count(*)::text as total from orders');
      return Number(result.rows[0]?.total ?? 0);
    },
    async dispose() {
      await client.close();
    },
  };
}

export async function loadProduct(
  harness: DriverHarness,
  productId: string,
): Promise<Product> {
  const product = await harness.products.findById(asProductId(productId) as ProductId);
  if (!product) throw new Error(`Unknown product ${productId}`);
  return product;
}

export async function loadOrder(harness: DriverHarness, orderId: string): Promise<Order | null> {
  return harness.orders.findById(orderId as OrderId);
}

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
