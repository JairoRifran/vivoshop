import { Inject, Injectable } from '@nestjs/common';
import type {
  Follow,
  LiveMessage,
  LiveSession,
  LiveSessionId,
  Order,
  OrderId,
  Product,
  ProductId,
  Store,
  StoreId,
  User,
  UserId,
} from '@vivo/domain';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  AnalyticsRepository,
  FollowRepository,
  LiveQuery,
  LiveRepository,
  MessageRepository,
  OrderQuery,
  OrderRepository,
  ProductQuery,
  ProductRepository,
  StoreQuery,
  StoreRepository,
  StoredAnalyticsEvent,
  StoredCredentials,
  UserRepository,
} from '../../../application/ports/repositories';
import { DRIZZLE, type VivoDatabase } from './client';
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
  toLiveSession,
  toMessage,
  toOrder,
  toProduct,
  toStore,
  toUser,
} from './mappers';
import * as t from './schema';

/**
 * PostgreSQL repositories.
 *
 * They implement exactly the same ports as the in-memory driver, so switching
 * `DATA_DRIVER` swaps these in with no change above the infrastructure layer.
 * Aggregates that span two tables (product + variants, order + items, session
 * + attached products) are written inside a transaction so a partial write is
 * impossible.
 */

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async findById(id: UserId): Promise<User | null> {
    const [row] = await this.db.select().from(t.users).where(eq(t.users.id, String(id))).limit(1);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(t.users)
      .where(eq(t.users.email, email.toLowerCase()))
      .limit(1);
    return row ? toUser(row) : null;
  }

  async findCredentialsByEmail(email: string): Promise<StoredCredentials | null> {
    const [row] = await this.db
      .select({ id: t.users.id, passwordHash: t.users.passwordHash })
      .from(t.users)
      .where(eq(t.users.email, email.toLowerCase()))
      .limit(1);
    return row ? { userId: row.id as UserId, passwordHash: row.passwordHash } : null;
  }

  async create(user: User, passwordHash: string): Promise<User> {
    await this.db.insert(t.users).values(fromUser(user, passwordHash));
    return user;
  }

  async update(user: User): Promise<User> {
    const { passwordHash: _ignored, ...rest } = fromUser(user, '');
    await this.db.update(t.users).set(rest).where(eq(t.users.id, String(user.id)));
    return user;
  }
}

@Injectable()
export class DrizzleStoreRepository implements StoreRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async findById(id: StoreId): Promise<Store | null> {
    const [row] = await this.db.select().from(t.stores).where(eq(t.stores.id, String(id))).limit(1);
    return row ? toStore(row) : null;
  }

  async findBySlug(slug: string): Promise<Store | null> {
    const [row] = await this.db.select().from(t.stores).where(eq(t.stores.slug, slug)).limit(1);
    return row ? toStore(row) : null;
  }

  async findByOwner(ownerId: UserId): Promise<Store | null> {
    const [row] = await this.db
      .select()
      .from(t.stores)
      .where(eq(t.stores.ownerId, String(ownerId)))
      .limit(1);
    return row ? toStore(row) : null;
  }

  async list(query: StoreQuery = {}): Promise<Store[]> {
    const filters = [eq(t.stores.status, 'active')];
    if (query.category) filters.push(eq(t.stores.category, query.category));
    if (query.search) {
      const needle = `%${query.search}%`;
      const match = or(ilike(t.stores.name, needle), ilike(t.stores.description, needle));
      if (match) filters.push(match);
    }

    const rows = await this.db
      .select()
      .from(t.stores)
      .where(and(...filters))
      .orderBy(desc(t.stores.followerCount))
      .limit(query.limit ?? 50);

    return rows.map(toStore);
  }

  async listByIds(ids: readonly StoreId[]): Promise<Store[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.stores)
      .where(inArray(t.stores.id, ids.map(String)));
    return rows.map(toStore);
  }

  async slugExists(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.stores.id })
      .from(t.stores)
      .where(eq(t.stores.slug, slug))
      .limit(1);
    return Boolean(row);
  }

  async create(store: Store): Promise<Store> {
    await this.db.insert(t.stores).values(fromStore(store));
    return store;
  }

  async update(store: Store): Promise<Store> {
    await this.db.update(t.stores).set(fromStore(store)).where(eq(t.stores.id, String(store.id)));
    return store;
  }
}

@Injectable()
export class DrizzleProductRepository implements ProductRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  /** Loads products and their variants with two queries, never N+1. */
  private async hydrate(rows: Array<typeof t.products.$inferSelect>): Promise<Product[]> {
    if (rows.length === 0) return [];

    const variantRows = await this.db
      .select()
      .from(t.productVariants)
      .where(
        inArray(
          t.productVariants.productId,
          rows.map((row) => row.id),
        ),
      );

    const byProduct = new Map<string, Array<typeof t.productVariants.$inferSelect>>();
    for (const variant of variantRows) {
      const bucket = byProduct.get(variant.productId) ?? [];
      bucket.push(variant);
      byProduct.set(variant.productId, bucket);
    }

    return rows.map((row) => toProduct(row, byProduct.get(row.id) ?? []));
  }

  async findById(id: ProductId): Promise<Product | null> {
    const rows = await this.db
      .select()
      .from(t.products)
      .where(eq(t.products.id, String(id)))
      .limit(1);
    const [product] = await this.hydrate(rows);
    return product ?? null;
  }

  async listByIds(ids: readonly ProductId[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.products)
      .where(inArray(t.products.id, ids.map(String)));
    return this.hydrate(rows);
  }

  async list(query: ProductQuery = {}): Promise<Product[]> {
    const filters = [];
    if (query.storeId) filters.push(eq(t.products.storeId, String(query.storeId)));
    if (query.status) filters.push(eq(t.products.status, query.status));
    if (query.search) {
      const needle = `%${query.search}%`;
      const match = or(ilike(t.products.title, needle), ilike(t.products.description, needle));
      if (match) filters.push(match);
    }

    const rows = await this.db
      .select()
      .from(t.products)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(t.products.updatedAt))
      .limit(query.limit ?? 100);

    return this.hydrate(rows);
  }

  async create(product: Product): Promise<Product> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.products).values(fromProduct(product));
      const variants = fromVariants(product);
      if (variants.length > 0) await tx.insert(t.productVariants).values(variants);
    });
    return product;
  }

  /**
   * Variants are replaced wholesale inside the transaction. Simpler than
   * diffing, and correct: the caller always sends the complete set.
   */
  async update(product: Product): Promise<Product> {
    await this.db.transaction(async (tx) => {
      await tx.update(t.products).set(fromProduct(product)).where(eq(t.products.id, String(product.id)));
      await tx.delete(t.productVariants).where(eq(t.productVariants.productId, String(product.id)));
      const variants = fromVariants(product);
      if (variants.length > 0) await tx.insert(t.productVariants).values(variants);
    });
    return product;
  }
}

@Injectable()
export class DrizzleLiveRepository implements LiveRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  private async hydrate(rows: Array<typeof t.liveSessions.$inferSelect>): Promise<LiveSession[]> {
    if (rows.length === 0) return [];

    const productRows = await this.db
      .select()
      .from(t.liveSessionProducts)
      .where(
        inArray(
          t.liveSessionProducts.liveSessionId,
          rows.map((row) => row.id),
        ),
      );

    const bySession = new Map<string, Array<typeof t.liveSessionProducts.$inferSelect>>();
    for (const entry of productRows) {
      const bucket = bySession.get(entry.liveSessionId) ?? [];
      bucket.push(entry);
      bySession.set(entry.liveSessionId, bucket);
    }

    return rows.map((row) => toLiveSession(row, bySession.get(row.id) ?? []));
  }

  async findById(id: LiveSessionId): Promise<LiveSession | null> {
    const rows = await this.db
      .select()
      .from(t.liveSessions)
      .where(eq(t.liveSessions.id, String(id)))
      .limit(1);
    const [session] = await this.hydrate(rows);
    return session ?? null;
  }

  async list(query: LiveQuery = {}): Promise<LiveSession[]> {
    const filters = [];
    if (query.status) filters.push(eq(t.liveSessions.status, query.status));
    if (query.storeId) filters.push(eq(t.liveSessions.storeId, String(query.storeId)));

    const rows = await this.db
      .select()
      .from(t.liveSessions)
      .where(filters.length > 0 ? and(...filters) : undefined)
      // Running sessions first, then the soonest scheduled, then most recent.
      .orderBy(
        sql`case ${t.liveSessions.status} when 'live' then 0 when 'scheduled' then 1 when 'ended' then 2 else 3 end`,
        desc(t.liveSessions.viewerCount),
        asc(t.liveSessions.scheduledAt),
      )
      .limit(query.limit ?? 50);

    return this.hydrate(rows);
  }

  async create(session: LiveSession): Promise<LiveSession> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.liveSessions).values(fromLiveSession(session));
      const products = fromLiveProducts(session);
      if (products.length > 0) await tx.insert(t.liveSessionProducts).values(products);
    });
    return session;
  }

  async update(session: LiveSession): Promise<LiveSession> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(t.liveSessions)
        .set(fromLiveSession(session))
        .where(eq(t.liveSessions.id, String(session.id)));
      await tx
        .delete(t.liveSessionProducts)
        .where(eq(t.liveSessionProducts.liveSessionId, String(session.id)));
      const products = fromLiveProducts(session);
      if (products.length > 0) await tx.insert(t.liveSessionProducts).values(products);
    });
    return session;
  }
}

@Injectable()
export class DrizzleMessageRepository implements MessageRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async listBySession(id: LiveSessionId, limit = 50): Promise<LiveMessage[]> {
    const rows = await this.db
      .select()
      .from(t.liveMessages)
      .where(eq(t.liveMessages.liveSessionId, String(id)))
      .orderBy(desc(t.liveMessages.createdAt))
      .limit(limit);

    // Newest-first from the index, oldest-first for the reader.
    return rows.reverse().map(toMessage);
  }

  async create(message: LiveMessage): Promise<LiveMessage> {
    await this.db.insert(t.liveMessages).values(fromMessage(message));
    return message;
  }
}

@Injectable()
export class DrizzleOrderRepository implements OrderRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  private async hydrate(rows: Array<typeof t.orders.$inferSelect>): Promise<Order[]> {
    if (rows.length === 0) return [];

    const itemRows = await this.db
      .select()
      .from(t.orderItems)
      .where(
        inArray(
          t.orderItems.orderId,
          rows.map((row) => row.id),
        ),
      );

    const byOrder = new Map<string, Array<typeof t.orderItems.$inferSelect>>();
    for (const item of itemRows) {
      const bucket = byOrder.get(item.orderId) ?? [];
      bucket.push(item);
      byOrder.set(item.orderId, bucket);
    }

    return rows.map((row) => toOrder(row, byOrder.get(row.id) ?? []));
  }

  async findById(id: OrderId): Promise<Order | null> {
    const rows = await this.db.select().from(t.orders).where(eq(t.orders.id, String(id))).limit(1);
    const [order] = await this.hydrate(rows);
    return order ?? null;
  }

  async list(query: OrderQuery = {}): Promise<Order[]> {
    const filters = [];
    if (query.buyerId) filters.push(eq(t.orders.buyerId, String(query.buyerId)));
    if (query.storeId) filters.push(eq(t.orders.storeId, String(query.storeId)));
    if (query.status) filters.push(eq(t.orders.status, query.status));
    if (query.liveSessionId) filters.push(eq(t.orders.liveSessionId, String(query.liveSessionId)));

    const rows = await this.db
      .select()
      .from(t.orders)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(t.orders.createdAt))
      .limit(query.limit ?? 100);

    return this.hydrate(rows);
  }

  async create(order: Order): Promise<Order> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.orders).values(fromOrder(order));
      const items = fromOrderItems(order);
      if (items.length > 0) await tx.insert(t.orderItems).values(items);
    });
    return order;
  }

  /** Items are immutable once placed, so only the order row is updated. */
  async update(order: Order): Promise<Order> {
    await this.db.update(t.orders).set(fromOrder(order)).where(eq(t.orders.id, String(order.id)));
    return order;
  }
}

@Injectable()
export class DrizzleFollowRepository implements FollowRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async exists(userId: UserId, storeId: StoreId): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: t.follows.userId })
      .from(t.follows)
      .where(and(eq(t.follows.userId, String(userId)), eq(t.follows.storeId, String(storeId))))
      .limit(1);
    return Boolean(row);
  }

  async listStoreIds(userId: UserId): Promise<StoreId[]> {
    const rows = await this.db
      .select({ storeId: t.follows.storeId })
      .from(t.follows)
      .where(eq(t.follows.userId, String(userId)))
      .orderBy(desc(t.follows.createdAt));
    return rows.map((row) => row.storeId as StoreId);
  }

  async listFollowerIds(storeId: StoreId): Promise<UserId[]> {
    const rows = await this.db
      .select({ userId: t.follows.userId })
      .from(t.follows)
      .where(eq(t.follows.storeId, String(storeId)));
    return rows.map((row) => row.userId as UserId);
  }

  async countFollowers(storeId: StoreId): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.follows)
      .where(eq(t.follows.storeId, String(storeId)));
    return row?.total ?? 0;
  }

  async add(follow: Follow): Promise<void> {
    await this.db
      .insert(t.follows)
      .values({
        userId: String(follow.userId),
        storeId: String(follow.storeId),
        notifyOnLive: follow.notifyOnLive,
        createdAt: follow.createdAt,
      })
      // Following twice is a no-op, not a constraint violation.
      .onConflictDoNothing();
  }

  async remove(userId: UserId, storeId: StoreId): Promise<void> {
    await this.db
      .delete(t.follows)
      .where(and(eq(t.follows.userId, String(userId)), eq(t.follows.storeId, String(storeId))));
  }
}

@Injectable()
export class DrizzleAnalyticsRepository implements AnalyticsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async record(event: StoredAnalyticsEvent): Promise<void> {
    await this.db.insert(t.analyticsEvents).values({
      id: event.id,
      name: event.name,
      userId: event.userId ? String(event.userId) : null,
      properties: event.properties,
      occurredAt: event.occurredAt,
    });
  }

  async countByName(name: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.analyticsEvents)
      .where(
        and(eq(t.analyticsEvents.name, name), sql`${t.analyticsEvents.occurredAt} >= ${since}`),
      );
    return row?.total ?? 0;
  }
}
