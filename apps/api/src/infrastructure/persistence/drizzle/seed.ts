import { buildDemoDataset } from '@vivo/seed';
import { PasswordService } from '../../security/password.service';
import { loadEnv } from '../../../config/env';
import { createDatabase, type VivoDatabase } from './client';
import {
  fromLiveProducts,
  fromLiveSession,
  fromMessage,
  fromOrder,
  fromOrderItems,
  fromProduct,
  fromStore,
  fromUser,
  fromVariants,
} from './mappers';
import * as t from './schema';

/**
 * Loads the demo dataset into PostgreSQL.
 *
 * The dataset comes from `@vivo/seed`, the same module the in-memory driver
 * uses, so both drivers boot into an identical world and a bug can never be
 * "only in one of them".
 *
 * Destructive by design: it truncates first. Refuses to run against
 * NODE_ENV=production without an explicit override.
 */
export async function seedDatabase(db: VivoDatabase, options: { now?: Date } = {}): Promise<void> {
  const dataset = buildDemoDataset(options.now ? { now: options.now } : {});
  const passwords = new PasswordService();

  await db.transaction(async (tx) => {
    // Order matters: children before parents.
    await tx.delete(t.analyticsEvents);
    await tx.delete(t.orderItems);
    await tx.delete(t.orders);
    await tx.delete(t.liveMessages);
    await tx.delete(t.liveSessionProducts);
    await tx.delete(t.liveSessions);
    await tx.delete(t.follows);
    await tx.delete(t.productVariants);
    await tx.delete(t.products);
    await tx.delete(t.stores);
    await tx.delete(t.users);

    for (const user of dataset.users) {
      const { password, ...rest } = user;
      await tx.insert(t.users).values(fromUser(rest, await passwords.hash(password)));
    }

    if (dataset.stores.length > 0) {
      await tx.insert(t.stores).values(dataset.stores.map(fromStore));
    }

    for (const product of dataset.products) {
      await tx.insert(t.products).values(fromProduct(product));
      const variants = fromVariants(product);
      if (variants.length > 0) await tx.insert(t.productVariants).values(variants);
    }

    for (const session of dataset.liveSessions) {
      await tx.insert(t.liveSessions).values(fromLiveSession(session));
      const products = fromLiveProducts(session);
      if (products.length > 0) await tx.insert(t.liveSessionProducts).values(products);
    }

    if (dataset.liveMessages.length > 0) {
      await tx.insert(t.liveMessages).values(dataset.liveMessages.map(fromMessage));
    }

    if (dataset.follows.length > 0) {
      await tx.insert(t.follows).values(
        dataset.follows.map((follow) => ({
          userId: String(follow.userId),
          storeId: String(follow.storeId),
          notifyOnLive: follow.notifyOnLive,
          createdAt: follow.createdAt,
        })),
      );
    }

    for (const order of dataset.orders) {
      await tx.insert(t.orders).values(fromOrder(order));
      const items = fromOrderItems(order);
      if (items.length > 0) await tx.insert(t.orderItems).values(items);
    }
  });
}

/* c8 ignore start -- CLI entry point, exercised by `pnpm db:seed`. */
async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction && process.env.ALLOW_PRODUCTION_SEED !== 'yes') {
    throw new Error(
      'Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=yes to override.',
    );
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed.');

  const { db, pool } = createDatabase(env.DATABASE_URL, {
    mode: env.DATABASE_SSL,
    caCert: env.DATABASE_CA_CERT,
  });
  try {
    await seedDatabase(db);
    console.log('Seed completo: tiendas, productos, transmisiones, pedidos y seguidores.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
