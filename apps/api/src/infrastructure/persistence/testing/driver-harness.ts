import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Order, OrderId, Product, ProductId, StoreId } from '@vivo/domain';
import { asProductId, asStoreId, asUserId } from '@vivo/domain';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { BidService } from '../../../application/services/bid.service';
import { CheckoutService } from '../../../application/services/checkout.service';
import type { LiveService } from '../../../application/services/live.service';
import { PaymentService } from '../../../application/services/payment.service';
import { developmentSecretBox } from '../../crypto/secret-box';
import { NoopRealtimePublisher } from '../../realtime/realtime.module';
import type { OrderTransactionRunner } from '../../../application/ports/order-transaction';
import type {
  OrderRepository,
  ProductRepository,
  UserRepository,
} from '../../../application/ports/repositories';
import type {
  OAuthStateRepository,
  PaymentRepository,
  PaymentTransactionRunner,
  SellerPaymentAccountRepository,
} from '../../../application/ports/payments';
import type { BidRepository, BidTransactionRunner } from '../../../application/ports/bids';
import { MemoryCacheStore } from '../../cache/memory-cache';
import { DrizzleBidRepository, DrizzleBidTransactionRunner } from '../drizzle/drizzle.bids';
import { MemoryBidRepository, MemoryBidTransactionRunner } from '../memory/memory.bids';
import { FakePaymentProvider } from '../../providers/fake-payment.provider';
import { loadEnv } from '../../../config/env';
import { PasswordService } from '../../security/password.service';
import { SystemClock, UuidGenerator } from '../../system';
import type { StoreService } from '../../../application/services/store.service';
import type { VivoDatabase } from '../drizzle/client';
import { DrizzleOrderTransactionRunner } from '../drizzle/drizzle.order-transaction';
import {
  DrizzleOAuthStateRepository,
  DrizzlePaymentRepository,
  DrizzlePaymentTransactionRunner,
  DrizzleSellerPaymentAccountRepository,
} from '../drizzle/drizzle.payments';
import {
  DrizzleOrderRepository,
  DrizzleProductRepository,
  DrizzleUserRepository,
} from '../drizzle/drizzle.repositories';
import { toStore } from '../drizzle/mappers';
import { schema } from '../drizzle/schema';
import { seedDatabase } from '../drizzle/seed';
import { MemoryDatabase } from '../memory/memory-database';
import { MemoryOrderTransactionRunner } from '../memory/memory.order-transaction';
import {
  MemoryOAuthStateRepository,
  MemoryPaymentRepository,
  MemoryPaymentTransactionRunner,
  MemorySellerPaymentAccountRepository,
} from '../memory/memory.payments';
import {
  MemoryOrderRepository,
  MemoryProductRepository,
  MemoryUserRepository,
} from '../memory/memory.repositories';

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
  /** El servicio de cobros del mismo driver, para probar el webhook con paridad. */
  readonly payments: PaymentService;
  /** El proveedor simulado detras de `payments`, para decidir desenlaces. */
  readonly provider: FakePaymentProvider;
  /** El Modo Puja del mismo driver, para probar concurrencia con paridad. */
  readonly bids: BidService;
  readonly bidRepo: BidRepository;
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
/** Dueña de `plaza-moda` en el dataset de demo. */
export const SELLER = 'martina';
export const SELLER_LIVE = 'live-plaza-otono';

const NOW = new Date('2026-03-01T20:00:00.000Z');

/**
 * `CheckoutService` only touches the store service on the preview and payment
 * paths; order creation reads the store inside the transaction. A narrow stub
 * keeps the harness from having to construct half the application graph.
 */
function storeServiceStub(
  load: (id: StoreId) => Promise<unknown>,
  owned?: () => Promise<unknown>,
): StoreService {
  return {
    requireById: async (id: StoreId) => load(id),
    requireOwned: async () => (owned ? owned() : load(STORE)),
  } as unknown as StoreService;
}

/**
 * El vivo, reducido a lo que el Modo Puja le pregunta.
 *
 * `SELLER_LIVE` está siempre al aire y le pertenece a `SELLER`. Basta para
 * ejercitar la puja sin arrastrar el gateway de WebRTC a un test de
 * persistencia — y si alguna vez la puja empezara a depender de algo más del
 * vivo, este stub lo haría fallar en vez de dejarlo pasar en silencio.
 */
function bidLiveStub(): LiveService {
  return {
    ...liveServiceStub(),
    findSession: async (id: unknown) =>
      String(id) === SELLER_LIVE
        ? { id: SELLER_LIVE, status: 'live', storeId: STORE }
        : null,
    isBroadcasterFor: async (_session: unknown, userId: unknown) => String(userId) === SELLER,
  } as unknown as LiveService;
}

/**
 * Arma el par checkout/cobros del driver.
 *
 * Con el proveedor simulado, que implementa el puerto completo: los tests del
 * webhook pasan por la misma normalizacion, la misma clave de idempotencia y
 * la misma transaccion que Mercado Pago. Es lo que hace que "anda con el
 * proveedor simulado" signifique algo.
 */
function buildServices(input: {
  products: ProductRepository;
  orders: OrderRepository;
  users: UserRepository;
  runner: OrderTransactionRunner;
  stores: StoreService;
  paymentRepo: PaymentRepository;
  accounts: SellerPaymentAccountRepository;
  oauthStates: OAuthStateRepository;
  paymentRunner: PaymentTransactionRunner;
  bidRepo: BidRepository;
  bidRunner: BidTransactionRunner;
}): {
  checkout: CheckoutService;
  payments: PaymentService;
  provider: FakePaymentProvider;
  bids: BidService;
} {
  const provider = new FakePaymentProvider(new UuidGenerator());
  const testEnv = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATA_DRIVER: 'memory',
    DATABASE_URL: undefined,
  });

  // El Modo Puja se arma primero: los cobros lo necesitan para cerrar una puja
  // cuando el pago se aprueba, y la dependencia va en un solo sentido.
  const bids = new BidService(
    input.bidRepo,
    input.bidRunner,
    input.products,
    input.users,
    new NoopRealtimePublisher(),
    new MemoryCacheStore(),
    new SystemClock(),
    new UuidGenerator(),
    testEnv,
    input.stores,
    bidLiveStub(),
  );

  const payments = new PaymentService(
    provider,
    input.paymentRepo,
    input.accounts,
    input.oauthStates,
    input.paymentRunner,
    input.users,
    new NoopRealtimePublisher(),
    new SystemClock(),
    new UuidGenerator(),
    testEnv,
    liveServiceStub(),
    bids,
  );

  const checkout = new CheckoutService(
    input.products,
    input.orders,
    input.runner,
    provider,
    new SystemClock(),
    new UuidGenerator(),
    input.stores,
    payments,
    bids,
  );

  return { checkout, payments, provider, bids };
}

// --- Memory ------------------------------------------------------------------

export async function createMemoryHarness(): Promise<DriverHarness> {
  const db = new MemoryDatabase();
  await db.seed((plain) => new PasswordService().hash(plain), { now: NOW });

  const products = new MemoryProductRepository(db);
  const orders = new MemoryOrderRepository(db);
  const faults = new FaultInjectingRunner(new MemoryOrderTransactionRunner(db));
  const stores = storeServiceStub(async (id) => db.stores.get(String(id)));
  const services = buildServices({
    products,
    orders,
    users: new MemoryUserRepository(db),
    runner: faults,
    stores,
    paymentRepo: new MemoryPaymentRepository(db),
    accounts: new MemorySellerPaymentAccountRepository(db),
    oauthStates: new MemoryOAuthStateRepository(db),
    paymentRunner: new MemoryPaymentTransactionRunner(db),
    bidRepo: new MemoryBidRepository(db),
    bidRunner: new MemoryBidTransactionRunner(db),
  });

  return {
    name: 'memory',
    checkout: services.checkout,
    payments: services.payments,
    provider: services.provider,
    bids: services.bids,
    bidRepo: new MemoryBidRepository(db),
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

  const services = buildServices({
    products,
    orders,
    users: new DrizzleUserRepository(db),
    runner: faults,
    stores,
    paymentRepo: new DrizzlePaymentRepository(db),
    accounts: new DrizzleSellerPaymentAccountRepository(db, developmentSecretBox()),
    oauthStates: new DrizzleOAuthStateRepository(db),
    paymentRunner: new DrizzlePaymentTransactionRunner(db),
    bidRepo: new DrizzleBidRepository(db),
    bidRunner: new DrizzleBidTransactionRunner(db),
  });

  return {
    name: 'postgres (pglite)',
    checkout: services.checkout,
    payments: services.payments,
    provider: services.provider,
    bids: services.bids,
    bidRepo: new DrizzleBidRepository(db),
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
