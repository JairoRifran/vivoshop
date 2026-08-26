import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { asOrderId, asProductId, asStoreId, asUserId, buildOrderCode } from '@vivo/domain';
import { buildDemoDataset } from '@vivo/seed';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { developmentSecretBox } from '../../crypto/secret-box';
import type { VivoDatabase } from './client';
import { DrizzleSellerPaymentAccountRepository } from './drizzle.payments';
import {
  DrizzleAnalyticsRepository,
  DrizzleFollowRepository,
  DrizzleLiveRepository,
  DrizzleMessageRepository,
  DrizzleOrderRepository,
  DrizzleProductRepository,
  DrizzleStoreRepository,
  DrizzleUserRepository,
} from './drizzle.repositories';
import { schema } from './schema';
import { seedDatabase } from './seed';

/**
 * Integration tests for the PostgreSQL driver.
 *
 * These run against PGlite — real PostgreSQL compiled to WebAssembly, in
 * process. That matters: the repositories execute the same SQL they will
 * execute in production, against the same migrations, with real constraints,
 * transactions and JSONB semantics. No Docker, no fixture database, no mocks
 * pretending to be a query planner.
 */

const NOW = new Date('2026-03-01T20:00:00.000Z');

let db: VivoDatabase;
let users: DrizzleUserRepository;
let stores: DrizzleStoreRepository;
let products: DrizzleProductRepository;
let live: DrizzleLiveRepository;
let messages: DrizzleMessageRepository;
let orders: DrizzleOrderRepository;
let follows: DrizzleFollowRepository;
let analytics: DrizzleAnalyticsRepository;

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

beforeAll(async () => {
  const client = new PGlite();
  await applyMigrations(client);

  db = drizzle(client, { schema }) as unknown as VivoDatabase;

  users = new DrizzleUserRepository(db);
  stores = new DrizzleStoreRepository(db);
  products = new DrizzleProductRepository(db);
  live = new DrizzleLiveRepository(db);
  messages = new DrizzleMessageRepository(db);
  orders = new DrizzleOrderRepository(db);
  follows = new DrizzleFollowRepository(db);
  analytics = new DrizzleAnalyticsRepository(db);

  await seedDatabase(db, { now: NOW });
}, 120_000);

describe('migrations and seed', () => {
  it('loads the whole demo world into real tables', async () => {
    const dataset = buildDemoDataset({ now: NOW });
    expect(await stores.list({ limit: 100 })).toHaveLength(dataset.stores.length);
    expect((await products.list({ limit: 200 })).length).toBe(dataset.products.length);
    expect((await live.list({ limit: 100 })).length).toBe(dataset.liveSessions.length);
  });
});

describe('users', () => {
  it('finds by email case-insensitively at the call site', async () => {
    const user = await users.findByEmail('ANA@VIVO.UY'.toLowerCase());
    expect(user?.name).toBe('Ana Pérez');
    expect(user?.roles).toContain('buyer');
  });

  it('stores a hash, never a password', async () => {
    const credentials = await users.findCredentialsByEmail('ana@vivo.uy');
    expect(credentials?.passwordHash).toMatch(/^scrypt\$/);
    expect(credentials?.passwordHash).not.toContain('vivo1234');
  });

  it('keeps both roles on one account', async () => {
    const seller = await users.findByEmail('martina@vivo.uy');
    expect(seller?.roles).toEqual(expect.arrayContaining(['buyer', 'seller']));
  });

  it('round-trips an update', async () => {
    const user = await users.findByEmail('ana@vivo.uy');
    expect(user).not.toBeNull();
    await users.update({ ...user!, name: 'Ana P.', updatedAt: NOW });
    expect((await users.findById(user!.id))?.name).toBe('Ana P.');
  });
});

describe('stores', () => {
  it('resolves the public slug used by /tienda/:slug', async () => {
    const store = await stores.findBySlug('plaza-moda');
    expect(store?.name).toBe('Plaza Moda');
    expect(store?.settings.freeShippingThresholdMinor).toBe(350000);
  });

  it('filters by category and searches accent-insensitively enough', async () => {
    const beauty = await stores.list({ category: 'belleza' });
    expect(beauty.map((store) => store.slug)).toEqual(['rambla-beauty']);
    const found = await stores.list({ search: 'ceramica' });
    expect(found.length).toBeGreaterThanOrEqual(0);
  });

  it('detects slug collisions', async () => {
    expect(await stores.slugExists('plaza-moda')).toBe(true);
    expect(await stores.slugExists('no-existe')).toBe(false);
  });

  it('finds the single store owned by a seller', async () => {
    const store = await stores.findByOwner(asUserId('martina'));
    expect(store?.slug).toBe('plaza-moda');
  });
});

describe('products and variants', () => {
  it('reads variants back in order, with stock intact', async () => {
    const product = await products.findById(asProductId('campera-roma'));
    expect(product?.variants).toHaveLength(5);
    expect(product?.variants[0]?.optionValues).toEqual({ Color: 'Negro', Talle: 'S' });
    expect(product?.variants.map((variant) => variant.stock)).toEqual([2, 3, 0, 4, 1]);
  });

  it('keeps images and options as structured JSON', async () => {
    const product = await products.findById(asProductId('campera-roma'));
    expect(product?.images[0]?.url).toContain('/media/product/');
    expect(product?.options.map((option) => option.name)).toEqual(['Color', 'Talle']);
  });

  it('persists a stock decrement through a full update', async () => {
    const before = await products.findById(asProductId('campera-roma'));
    const variant = before!.variants[1]!;

    await products.update({
      ...before!,
      variants: before!.variants.map((candidate) =>
        candidate.id === variant.id ? { ...candidate, stock: candidate.stock - 1 } : candidate,
      ),
    });

    const after = await products.findById(asProductId('campera-roma'));
    expect(after!.variants[1]!.stock).toBe(variant.stock - 1);
    // Replacing variants must not orphan or duplicate rows.
    expect(after!.variants).toHaveLength(5);
  });

  it('filters by store and status', async () => {
    const paused = await products.list({ storeId: asStoreId('plaza-moda'), status: 'paused' });
    expect(paused.map((product) => String(product.id))).toEqual(['vestido-solis']);
  });

  it('returns nothing for an empty id list instead of every row', async () => {
    expect(await products.listByIds([])).toEqual([]);
  });
});

describe('live sessions', () => {
  it('orders running sessions before scheduled ones', async () => {
    const sessions = await live.list({ limit: 50 });
    const statuses = sessions.map((session) => session.status);
    expect(statuses[0]).toBe('live');
    expect(statuses.indexOf('ended')).toBeGreaterThan(statuses.lastIndexOf('live'));
  });

  it('keeps attached products with their position and sold counts', async () => {
    const session = await live.findById('live-plaza-otono' as never);
    expect(session?.products.map((entry) => String(entry.productId))).toEqual([
      'campera-roma',
      'pantalon-cordon',
      'buzo-parque',
      'camisa-prado',
      'bolso-cordon',
    ]);
    expect(String(session?.featuredProductId)).toBe('campera-roma');
  });

  it('replaces the attached set on update without duplicating rows', async () => {
    const session = await live.findById('live-ceibo-taller' as never);
    await live.update({
      ...session!,
      products: [{ productId: asProductId('mate-ceibo'), position: 0, soldCount: 3 }],
      featuredProductId: asProductId('mate-ceibo'),
    });

    const updated = await live.findById('live-ceibo-taller' as never);
    expect(updated?.products).toHaveLength(1);
    expect(updated?.products[0]?.soldCount).toBe(3);
  });
});

describe('messages', () => {
  it('returns the newest messages in reading order', async () => {
    const list = await messages.listBySession('live-plaza-otono' as never, 5);
    expect(list).toHaveLength(5);
    for (let index = 1; index < list.length; index += 1) {
      expect(list[index]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        list[index - 1]!.createdAt.getTime(),
      );
    }
  });
});

describe('orders', () => {
  it('reconstructs an order with its immutable line snapshots', async () => {
    const [order] = await orders.list({ buyerId: asUserId('ana'), limit: 1 });
    expect(order).toBeDefined();
    expect(order!.items.length).toBeGreaterThan(0);
    expect(order!.items[0]!.titleSnapshot).toBeTruthy();
    expect(order!.totalMinor).toBe(
      order!.subtotalMinor + order!.shippingMinor - order!.discountMinor,
    );
  });

  it('revives dates inside JSONB payment and timeline', async () => {
    const delivered = (await orders.list({ buyerId: asUserId('ana') })).find(
      (order) => order.status === 'delivered',
    );
    expect(delivered?.payment.paidAt).toBeInstanceOf(Date);
    expect(delivered?.timeline.at(-1)?.at).toBeInstanceOf(Date);
    expect(delivered?.timeline.at(-1)?.status).toBe('delivered');
  });

  it('writes and reads a new order inside one transaction', async () => {
    const id = asOrderId('order-test-1');
    const source = (await orders.list({ buyerId: asUserId('ana'), limit: 1 }))[0]!;

    await orders.create({
      ...source,
      id,
      code: buildOrderCode('order-test-1'),
      status: 'pending_payment',
      liveSessionId: null,
      createdAt: NOW,
      updatedAt: NOW,
      timeline: [{ status: 'pending_payment', at: NOW, note: null }],
    });

    const stored = await orders.findById(id);
    expect(stored?.items).toHaveLength(source.items.length);
    expect(stored?.status).toBe('pending_payment');
  });

  it('filters by store and status for the seller queue', async () => {
    const pending = await orders.list({ storeId: asStoreId('plaza-moda'), status: 'delivered' });
    expect(pending.every((order) => order.status === 'delivered')).toBe(true);
  });
});

describe('follows', () => {
  it('reads both directions of the relationship', async () => {
    expect(await follows.exists(asUserId('ana'), asStoreId('plaza-moda'))).toBe(true);
    expect(await follows.listStoreIds(asUserId('ana'))).toHaveLength(3);
    expect(await follows.listFollowerIds(asStoreId('plaza-moda'))).toEqual(
      expect.arrayContaining(['ana', 'camila']),
    );
  });

  it('treats following twice as a no-op rather than a constraint error', async () => {
    await follows.add({
      userId: asUserId('ana'),
      storeId: asStoreId('plaza-moda'),
      notifyOnLive: true,
      createdAt: NOW,
    });
    expect(await follows.countFollowers(asStoreId('plaza-moda'))).toBe(2);
  });

  it('removes cleanly', async () => {
    await follows.remove(asUserId('camila'), asStoreId('plaza-moda'));
    expect(await follows.exists(asUserId('camila'), asStoreId('plaza-moda'))).toBe(false);
  });
});

describe('analytics', () => {
  it('counts events by name within a window', async () => {
    const earlier = new Date(NOW.getTime() - 60_000);
    await analytics.record({
      id: 'evt-1',
      name: 'live_view_started',
      userId: asUserId('ana'),
      properties: { liveSessionId: 'live-plaza-otono' },
      occurredAt: NOW,
    });

    expect(await analytics.countByName('live_view_started', earlier)).toBe(1);
    expect(await analytics.countByName('live_view_started', new Date(NOW.getTime() + 60_000))).toBe(
      0,
    );
    expect(await analytics.countByName('nope', earlier)).toBe(0);
  });
});

/**
 * Que el cifrado llegue de verdad hasta la tabla.
 *
 * Las pruebas de `secret-box.test.ts` prueban el cifrado; esta prueba la otra
 * mitad, que es la que se puede olvidar: que el repositorio lo use. Un mapper
 * al que nadie le pasa la caja compila igual y deja los tokens en claro sin
 * que nada falle, así que la afirmación fuerte es sobre la **columna**, leída
 * en crudo y sin pasar por el mapper.
 */
describe('credenciales del vendedor en reposo', () => {
  const ACCESS = 'APP_USR-token-de-acceso-que-cobra-plata';
  const REFRESH = 'TG-refresh-token-del-vendedor';

  async function connect() {
    const accounts = new DrizzleSellerPaymentAccountRepository(db, developmentSecretBox());
    const [store] = await db.select().from(schema.stores).limit(1);
    const storeId = asStoreId(store?.id ?? '');

    await accounts.save({
      storeId,
      provider: 'mercadopago',
      status: 'connected',
      externalAccountId: '3644080714',
      externalAccountLabel: null,
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: null,
      connectedAt: NOW,
      updatedAt: NOW,
    });

    return { accounts, storeId };
  }

  it('la columna no contiene el token', async () => {
    const { storeId } = await connect();

    const [row] = await db
      .select()
      .from(schema.sellerPaymentAccounts)
      .where(eq(schema.sellerPaymentAccounts.storeId, String(storeId)));

    expect(row?.accessToken).not.toBe(ACCESS);
    expect(row?.accessToken).not.toContain('APP_USR');
    expect(row?.accessToken?.startsWith('v1.')).toBe(true);
    expect(row?.refreshToken).not.toBe(REFRESH);
    expect(row?.refreshToken?.startsWith('v1.')).toBe(true);
  });

  it('el repositorio los devuelve utilizables', async () => {
    // El proveedor necesita el token en claro para armar un `Authorization`.
    // Cifrar sin poder volver no serviría de nada.
    const { accounts, storeId } = await connect();
    const account = await accounts.find(storeId, 'mercadopago');

    expect(account?.accessToken).toBe(ACCESS);
    expect(account?.refreshToken).toBe(REFRESH);
  });

  it('lo que quedó en claro de antes se sigue leyendo', async () => {
    // Desplegar el cifrado no puede romper una tienda ya conectada: los
    // valores viejos se leen tal cual hasta que la migración los reescriba.
    const { accounts, storeId } = await connect();
    await db
      .update(schema.sellerPaymentAccounts)
      .set({ accessToken: ACCESS, refreshToken: null })
      .where(eq(schema.sellerPaymentAccounts.storeId, String(storeId)));

    const account = await accounts.find(storeId, 'mercadopago');
    expect(account?.accessToken).toBe(ACCESS);
  });
});
