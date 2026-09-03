import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthProvider,
  UserIdentity,
  PasswordResetToken,
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
  PushDeliveryType,
  PushSubscription,
} from '@vivo/domain';
import { asUserId } from '@vivo/domain';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type {
  AccountDeletionRepository,
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
  LoginState,
  LoginStateRepository,
  PasswordResetRepository,
  UserIdentityRepository,
  PushDeliveryRepository,
  PushSubscriptionRepository,
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
    // Sin hash no hay credenciales: es una cuenta que solo se abre con un
    // proveedor. Devolver null hace que el login por contrasena falle como
    // "email o contrasena incorrectos", que es exactamente lo correcto.
    return row?.passwordHash ? { userId: row.id as UserId, passwordHash: row.passwordHash } : null;
  }

  async setPassword(id: UserId, passwordHash: string, changedAt: Date): Promise<void> {
    // Un solo UPDATE: separarlos dejaria una ventana con la contrasena nueva y
    // las sesiones viejas todavia validas, que es lo que se esta cerrando.
    await this.db
      .update(t.users)
      .set({ passwordHash, passwordChangedAt: changedAt, updatedAt: changedAt })
      .where(eq(t.users.id, String(id)));
  }

  async create(user: User, passwordHash: string | null): Promise<User> {
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
      // `notifyOnLive` estaba en el dominio desde M01 y esta consulta lo
      // ignoraba. Mientras no se enviaba nada daba igual; con avisos de verdad,
      // mandarle a quien lo apagó es la forma más rápida de que apague todo.
      .where(and(eq(t.follows.storeId, String(storeId)), eq(t.follows.notifyOnLive, true)));
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

  async notifyOnLive(userId: UserId, storeId: StoreId): Promise<boolean | null> {
    const [row] = await this.db
      .select({ notifyOnLive: t.follows.notifyOnLive })
      .from(t.follows)
      .where(and(eq(t.follows.userId, String(userId)), eq(t.follows.storeId, String(storeId))))
      .limit(1);
    return row?.notifyOnLive ?? null;
  }

  async setNotifyOnLive(userId: UserId, storeId: StoreId, notify: boolean): Promise<void> {
    await this.db
      .update(t.follows)
      .set({ notifyOnLive: notify })
      .where(and(eq(t.follows.userId, String(userId)), eq(t.follows.storeId, String(storeId))));
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


/**
 * Los navegadores suscritos, en PostgreSQL.
 *
 * Guardar es siempre un upsert sobre el `endpoint`: el mismo navegador
 * volviendo a suscribirse actualiza su fila. Si fuera un insert, dos
 * suscripciones del mismo destino significarían dos avisos por vivo.
 */
@Injectable()
export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async save(subscription: PushSubscription): Promise<void> {
    const values = {
      endpoint: subscription.endpoint,
      userId: String(subscription.userId),
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: subscription.userAgent,
      createdAt: subscription.createdAt,
      lastNotifiedAt: subscription.lastNotifiedAt,
    };

    await this.db
      .insert(t.pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: t.pushSubscriptions.endpoint,
        // `createdAt` no se pisa: la fila es la misma suscripción, no una nueva.
        // Y el `userId` sí, porque un navegador compartido puede cambiar de
        // dueño y el aviso tiene que seguir a quien está usándolo ahora.
        set: {
          userId: values.userId,
          p256dh: values.p256dh,
          auth: values.auth,
          userAgent: values.userAgent,
        },
      });
  }

  async listForUsers(userIds: readonly UserId[]): Promise<PushSubscription[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.pushSubscriptions)
      .where(inArray(t.pushSubscriptions.userId, userIds.map(String)));
    return rows.map(toPushSubscription);
  }

  async listForUser(userId: UserId): Promise<PushSubscription[]> {
    const rows = await this.db
      .select()
      .from(t.pushSubscriptions)
      .where(eq(t.pushSubscriptions.userId, String(userId)));
    return rows.map(toPushSubscription);
  }

  async remove(endpoint: string): Promise<void> {
    await this.db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.endpoint, endpoint));
  }

  async removeMany(endpoints: readonly string[]): Promise<void> {
    if (endpoints.length === 0) return;
    await this.db
      .delete(t.pushSubscriptions)
      .where(inArray(t.pushSubscriptions.endpoint, [...endpoints]));
  }

  async markNotified(endpoints: readonly string[], at: Date): Promise<void> {
    if (endpoints.length === 0) return;
    await this.db
      .update(t.pushSubscriptions)
      .set({ lastNotifiedAt: at })
      .where(inArray(t.pushSubscriptions.endpoint, [...endpoints]));
  }
}

function toPushSubscription(row: {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastNotifiedAt: Date | null;
}): PushSubscription {
  return {
    endpoint: row.endpoint,
    userId: row.userId as UserId,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastNotifiedAt: row.lastNotifiedAt,
  };
}


/**
 * Las constancias de envío, en PostgreSQL.
 *
 * `reserve` es un solo `insert … on conflict do nothing … returning`. Esa
 * combinación es la garantía entera: PostgreSQL decide quién gana cada destino
 * y devuelve únicamente las filas que realmente insertó, así que dos réplicas
 * anunciando el mismo vivo se reparten los destinos sin solaparse y sin que
 * ninguna tenga que leer antes.
 */
@Injectable()
export class DrizzlePushDeliveryRepository implements PushDeliveryRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async reserve(input: {
    liveSessionId: LiveSessionId;
    endpoints: readonly string[];
    type: PushDeliveryType;
    at: Date;
  }): Promise<string[]> {
    if (input.endpoints.length === 0) return [];

    const claimed = await this.db
      .insert(t.pushDeliveries)
      .values(
        input.endpoints.map((endpoint) => ({
          liveSessionId: String(input.liveSessionId),
          endpoint,
          type: input.type,
          createdAt: input.at,
        })),
      )
      .onConflictDoNothing()
      .returning({ endpoint: t.pushDeliveries.endpoint });

    return claimed.map((row) => row.endpoint);
  }

  async countFor(liveSessionId: LiveSessionId, type: PushDeliveryType): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.pushDeliveries)
      .where(
        and(
          eq(t.pushDeliveries.liveSessionId, String(liveSessionId)),
          eq(t.pushDeliveries.type, type),
        ),
      );
    return row?.total ?? 0;
  }
}

/**
 * Las formas de entrar, en Postgres.
 *
 * `link` es un upsert sobre la clave primaria (proveedor, id del proveedor).
 * Dos callbacks simultáneos del mismo proveedor —dos pestañas, un doble clic—
 * no pueden crear dos filas ni reventar con una violación de unicidad: el
 * segundo actualiza la del primero.
 */
@Injectable()
export class DrizzleUserIdentityRepository implements UserIdentityRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async find(provider: AuthProvider, providerUserId: string): Promise<UserIdentity | null> {
    const [row] = await this.db
      .select()
      .from(t.userIdentities)
      .where(
        and(
          eq(t.userIdentities.provider, provider),
          eq(t.userIdentities.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    return row ? toUserIdentity(row) : null;
  }

  async listForUser(userId: UserId): Promise<UserIdentity[]> {
    const rows = await this.db
      .select()
      .from(t.userIdentities)
      .where(eq(t.userIdentities.userId, String(userId)));
    return rows.map(toUserIdentity);
  }

  async link(identity: UserIdentity): Promise<UserIdentity> {
    await this.db
      .insert(t.userIdentities)
      .values({
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        userId: String(identity.userId),
        email: identity.email,
        createdAt: identity.createdAt,
      })
      .onConflictDoUpdate({
        target: [t.userIdentities.provider, t.userIdentities.providerUserId],
        set: { email: identity.email },
      });
    return identity;
  }
}

/**
 * Los ingresos en vuelo, en Postgres.
 *
 * `consume` es **una sola sentencia**: el `update` filtra por no consumido y
 * no vencido, y devuelve la fila solo si él fue quien la marcó. Dos callbacks
 * con el mismo `state` compiten en la base y gana uno; el otro recibe cero
 * filas y su ingreso se rechaza.
 *
 * Leer y después escribir tendría una ventana entre las dos operaciones, y esa
 * ventana es exactamente el ataque del que protege el `state`.
 */
@Injectable()
export class DrizzleLoginStateRepository implements LoginStateRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async create(state: LoginState): Promise<void> {
    await this.db.insert(t.loginStates).values({
      state: state.state,
      provider: state.provider,
      codeVerifier: state.codeVerifier,
      returnTo: state.returnTo,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      consumedAt: null,
    });
  }

  async consume(state: string, now: Date): Promise<LoginState | null> {
    const [row] = await this.db
      .update(t.loginStates)
      .set({ consumedAt: now })
      .where(
        and(
          eq(t.loginStates.state, state),
          isNull(t.loginStates.consumedAt),
          gt(t.loginStates.expiresAt, now),
        ),
      )
      .returning();

    return row
      ? {
          state: row.state,
          provider: row.provider as AuthProvider,
          codeVerifier: row.codeVerifier,
          returnTo: row.returnTo,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          consumedAt: null,
        }
      : null;
  }
}

function toUserIdentity(row: {
  provider: string;
  providerUserId: string;
  userId: string;
  email: string | null;
  createdAt: Date;
}): UserIdentity {
  return {
    provider: row.provider as AuthProvider,
    providerUserId: row.providerUserId,
    userId: asUserId(row.userId),
    email: row.email,
    createdAt: row.createdAt,
  };
}


/**
 * Permisos de restablecimiento, en Postgres.
 *
 * `consume` es **una sola sentencia**: el `update` filtra por no consumido y no
 * vencido, y devuelve la fila solo si el la marco. Dos pestanas con el mismo
 * enlace compiten en la base y gana una; la otra recibe cero filas. Leer y
 * despues escribir tendria una ventana entre las dos operaciones, y en un
 * permiso de un solo uso esa ventana es el agujero.
 */
@Injectable()
export class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async create(token: PasswordResetToken): Promise<void> {
    await this.db.insert(t.passwordResetTokens).values({
      tokenHash: token.tokenHash,
      userId: String(token.userId),
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      consumedAt: null,
    });
  }

  async consume(tokenHash: string, now: Date): Promise<PasswordResetToken | null> {
    const [row] = await this.db
      .update(t.passwordResetTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(t.passwordResetTokens.tokenHash, tokenHash),
          isNull(t.passwordResetTokens.consumedAt),
          gt(t.passwordResetTokens.expiresAt, now),
        ),
      )
      .returning();

    return row
      ? {
          tokenHash: row.tokenHash,
          userId: asUserId(row.userId),
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          consumedAt: null,
        }
      : null;
  }

  async consumeAllFor(userId: UserId, now: Date): Promise<void> {
    await this.db
      .update(t.passwordResetTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(t.passwordResetTokens.userId, String(userId)),
          isNull(t.passwordResetTokens.consumedAt),
        ),
      );
  }
}

/**
 * El borrado de cuenta, contra Postgres.
 *
 * Todo dentro de **una transaccion**. Es lo que separa un borrado de una cuenta
 * a medio borrar: sin transaccion, un fallo de red en la sexta tabla deja a
 * alguien sin identidades pero con el correo intacto, y nadie se entera.
 *
 * El archivo de la foto **no** se borra aca. El almacenamiento no participa de
 * la transaccion, asi que su clave se devuelve y el servicio lo borra despues:
 * si Supabase esta caido, los datos ya se fueron igual y lo que queda es un
 * archivo huerfano, que es infinitamente mejor que una cuenta a medio anonimizar.
 */
@Injectable()
export class DrizzleAccountDeletionRepository implements AccountDeletionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async countOrdersInFlight(
    userId: UserId,
  ): Promise<{ comoComprador: number; comoVendedor: number }> {
    const terminales = ['completed', 'cancelled'];

    // Una sola consulta con dos agregados: leer un lado y despues el otro deja
    // una ventana en la que el segundo cambio.
    const [row] = await this.db
      .select({
        comoComprador: sql<number>`count(*) filter (where ${t.orders.buyerId} = ${String(userId)})`,
        comoVendedor: sql<number>`count(*) filter (where ${t.orders.storeId} in (select ${t.stores.id} from ${t.stores} where ${t.stores.ownerId} = ${String(userId)}))`,
      })
      .from(t.orders)
      .where(sql`${t.orders.status} not in (${sql.join(terminales.map((e) => sql`${e}`), sql`, `)})`);

    return {
      comoComprador: Number(row?.comoComprador ?? 0),
      comoVendedor: Number(row?.comoVendedor ?? 0),
    };
  }

  async anonymize(input: {
    userId: UserId;
    email: string;
    name: string;
    changedAt: Date;
  }): Promise<{ avatarUrl: string | null }> {
    const id = String(input.userId);

    return this.db.transaction(async (tx) => {
      const [previo] = await tx
        .select({ avatarUrl: t.users.avatarUrl })
        .from(t.users)
        .where(eq(t.users.id, id))
        .limit(1);

      await tx
        .update(t.users)
        .set({
          name: input.name,
          email: input.email,
          phone: null,
          avatarUrl: null,
          bio: null,
          passwordHash: null,
          status: 'deleted',
          // La misma fecha de corte que usa el cambio de contrasena (M08): con
          // esto, toda sesion abierta muere en la siguiente peticion.
          passwordChangedAt: input.changedAt,
          updatedAt: input.changedAt,
        })
        .where(eq(t.users.id, id));

      await tx.delete(t.userIdentities).where(eq(t.userIdentities.userId, id));
      await tx.delete(t.passwordResetTokens).where(eq(t.passwordResetTokens.userId, id));
      await tx.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.userId, id));
      await tx.delete(t.follows).where(eq(t.follows.userId, id));
      await tx.delete(t.identityVerifications).where(eq(t.identityVerifications.userId, id));

      // Los mensajes no se borran: hubo otras personas en esa conversacion. Se
      // despersonalizan.
      await tx
        .update(t.liveMessages)
        .set({ authorName: input.name, authorAvatarUrl: null })
        .where(eq(t.liveMessages.authorId, id));

      // La tienda se pausa, no se borra: los pedidos historicos la referencian.
      await tx.update(t.stores).set({ status: 'paused' }).where(eq(t.stores.ownerId, id));

      return { avatarUrl: previo?.avatarUrl ?? null };
    });
  }
}
