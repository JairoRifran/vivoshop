import { Injectable } from '@nestjs/common';
import { isWatchable } from '@vivo/domain';
import type {
  Follow,
  LiveMessage,
  LiveSession,
  LiveSessionId,
  LiveStatus,
  Order,
  OrderId,
  Product,
  ProductId,
  Store,
  StoreId,
  User,
  UserId,
  PushSubscription,
} from '@vivo/domain';
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
  PushSubscriptionRepository,
} from '../../../application/ports/repositories';
import { MemoryDatabase } from './memory-database';

/** Accent-insensitive, case-insensitive contains. Good enough for a demo search. */
function matches(haystack: string, needle: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  return normalize(haystack).includes(normalize(needle));
}

function take<T>(items: T[], limit?: number): T[] {
  return typeof limit === 'number' ? items.slice(0, limit) : items;
}

@Injectable()
export class MemoryUserRepository implements UserRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findById(id: UserId): Promise<User | null> {
    return this.db.users.get(String(id)) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.db.users.values()) {
      if (user.email === normalized) return user;
    }
    return null;
  }

  async findCredentialsByEmail(email: string): Promise<StoredCredentials | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;
    const passwordHash = this.db.credentials.get(String(user.id));
    return passwordHash ? { userId: user.id, passwordHash } : null;
  }

  async create(user: User, passwordHash: string): Promise<User> {
    this.db.users.set(String(user.id), user);
    this.db.credentials.set(String(user.id), passwordHash);
    return user;
  }

  async update(user: User): Promise<User> {
    this.db.users.set(String(user.id), user);
    return user;
  }
}

@Injectable()
export class MemoryStoreRepository implements StoreRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findById(id: StoreId): Promise<Store | null> {
    return this.db.stores.get(String(id)) ?? null;
  }

  async findBySlug(slug: string): Promise<Store | null> {
    for (const store of this.db.stores.values()) {
      if (store.slug === slug) return store;
    }
    return null;
  }

  async findByOwner(ownerId: UserId): Promise<Store | null> {
    for (const store of this.db.stores.values()) {
      if (store.ownerId === ownerId) return store;
    }
    return null;
  }

  async list(query: StoreQuery = {}): Promise<Store[]> {
    const items = [...this.db.stores.values()]
      .filter((store) => store.status === 'active')
      .filter((store) => (query.category ? store.category === query.category : true))
      .filter((store) =>
        query.search ? matches(store.name, query.search) || matches(store.description, query.search) : true,
      )
      .sort((a, b) => b.followerCount - a.followerCount);
    return take(items, query.limit);
  }

  async listByIds(ids: readonly StoreId[]): Promise<Store[]> {
    return ids
      .map((id) => this.db.stores.get(String(id)))
      .filter((store): store is Store => Boolean(store));
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.findBySlug(slug)) !== null;
  }

  async create(store: Store): Promise<Store> {
    this.db.stores.set(String(store.id), store);
    return store;
  }

  async update(store: Store): Promise<Store> {
    this.db.stores.set(String(store.id), store);
    return store;
  }
}

@Injectable()
export class MemoryProductRepository implements ProductRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findById(id: ProductId): Promise<Product | null> {
    return this.db.products.get(String(id)) ?? null;
  }

  async listByIds(ids: readonly ProductId[]): Promise<Product[]> {
    return ids
      .map((id) => this.db.products.get(String(id)))
      .filter((product): product is Product => Boolean(product));
  }

  async list(query: ProductQuery = {}): Promise<Product[]> {
    const items = [...this.db.products.values()]
      .filter((product) => (query.storeId ? product.storeId === query.storeId : true))
      .filter((product) => (query.status ? product.status === query.status : true))
      .filter((product) =>
        query.search
          ? matches(product.title, query.search) || matches(product.description, query.search)
          : true,
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return take(items, query.limit);
  }

  async create(product: Product): Promise<Product> {
    this.db.products.set(String(product.id), product);
    return product;
  }

  async update(product: Product): Promise<Product> {
    this.db.products.set(String(product.id), product);
    return product;
  }
}

@Injectable()
export class MemoryLiveRepository implements LiveRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findById(id: LiveSessionId): Promise<LiveSession | null> {
    return this.db.liveSessions.get(String(id)) ?? null;
  }

  async list(query: LiveQuery = {}): Promise<LiveSession[]> {
    const items = [...this.db.liveSessions.values()]
      .filter((session) => (query.status ? session.status === query.status : true))
      .filter((session) => (query.storeId ? session.storeId === query.storeId : true))
      .sort((a, b) => {
        // Anything on air first, then the soonest scheduled, then most recent.
        // `interrupted` ranks alongside `live` on purpose: a seller whose
        // signal dropped for ten seconds should not fall off the home page.
        if (a.status !== b.status) {
          const rank: Record<LiveStatus, number> = {
            live: 0,
            interrupted: 0,
            starting: 1,
            ending: 1,
            scheduled: 2,
            ended: 3,
            cancelled: 4,
          };
          const delta = rank[a.status] - rank[b.status];
          if (delta !== 0) return delta;
        }
        if (isWatchable(a) && isWatchable(b)) return b.viewerCount - a.viewerCount;
        if (a.status === 'scheduled') {
          return (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0);
        }
        return (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0);
      });
    return take(items, query.limit);
  }

  async create(session: LiveSession): Promise<LiveSession> {
    this.db.liveSessions.set(String(session.id), session);
    return session;
  }

  async update(session: LiveSession): Promise<LiveSession> {
    this.db.liveSessions.set(String(session.id), session);
    return session;
  }
}

@Injectable()
export class MemoryMessageRepository implements MessageRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async listBySession(id: LiveSessionId, limit = 50): Promise<LiveMessage[]> {
    return [...this.db.liveMessages.values()]
      .filter((message) => message.liveSessionId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-limit);
  }

  async create(message: LiveMessage): Promise<LiveMessage> {
    this.db.liveMessages.set(String(message.id), message);
    return message;
  }
}

@Injectable()
export class MemoryOrderRepository implements OrderRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findById(id: OrderId): Promise<Order | null> {
    return this.db.orders.get(String(id)) ?? null;
  }

  async list(query: OrderQuery = {}): Promise<Order[]> {
    const items = [...this.db.orders.values()]
      .filter((order) => (query.buyerId ? order.buyerId === query.buyerId : true))
      .filter((order) => (query.storeId ? order.storeId === query.storeId : true))
      .filter((order) => (query.status ? order.status === query.status : true))
      .filter((order) => (query.liveSessionId ? order.liveSessionId === query.liveSessionId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return take(items, query.limit);
  }

  async create(order: Order): Promise<Order> {
    this.db.orders.set(String(order.id), order);
    return order;
  }

  async update(order: Order): Promise<Order> {
    this.db.orders.set(String(order.id), order);
    return order;
  }
}

@Injectable()
export class MemoryFollowRepository implements FollowRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async exists(userId: UserId, storeId: StoreId): Promise<boolean> {
    return this.db.follows.has(MemoryDatabase.followKey(String(userId), String(storeId)));
  }

  async listStoreIds(userId: UserId): Promise<StoreId[]> {
    return [...this.db.follows.values()]
      .filter((follow) => follow.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((follow) => follow.storeId);
  }

  async listFollowerIds(storeId: StoreId): Promise<UserId[]> {
    return [...this.db.follows.values()]
      // Igual que el driver de postgres: solo quienes quieren enterarse.
      .filter((follow) => follow.storeId === storeId && follow.notifyOnLive)
      .map((follow) => follow.userId);
  }

  async countFollowers(storeId: StoreId): Promise<number> {
    let count = 0;
    for (const follow of this.db.follows.values()) {
      if (follow.storeId === storeId) count += 1;
    }
    return count;
  }

  async add(follow: Follow): Promise<void> {
    this.db.follows.set(
      MemoryDatabase.followKey(String(follow.userId), String(follow.storeId)),
      follow,
    );
  }

  async setNotifyOnLive(userId: UserId, storeId: StoreId, notify: boolean): Promise<void> {
    const key = MemoryDatabase.followKey(String(userId), String(storeId));
    const existing = this.db.follows.get(key);
    if (existing) this.db.follows.set(key, { ...existing, notifyOnLive: notify });
  }

  async remove(userId: UserId, storeId: StoreId): Promise<void> {
    this.db.follows.delete(MemoryDatabase.followKey(String(userId), String(storeId)));
  }
}

@Injectable()
export class MemoryAnalyticsRepository implements AnalyticsRepository {
  /** Bounded so a long-running dev server cannot grow without limit. */
  private static readonly MAX_EVENTS = 5_000;

  constructor(private readonly db: MemoryDatabase) {}

  async record(event: StoredAnalyticsEvent): Promise<void> {
    this.db.analytics.push(event);
    if (this.db.analytics.length > MemoryAnalyticsRepository.MAX_EVENTS) {
      this.db.analytics.splice(0, this.db.analytics.length - MemoryAnalyticsRepository.MAX_EVENTS);
    }
  }

  async countByName(name: string, since: Date): Promise<number> {
    return this.db.analytics.filter(
      (event) => event.name === name && event.occurredAt >= since,
    ).length;
  }
}


/** Los navegadores suscritos, en memoria. Misma semántica de upsert. */
@Injectable()
export class MemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async save(subscription: PushSubscription): Promise<void> {
    const existing = this.db.pushSubscriptions.get(subscription.endpoint);
    // `createdAt` se conserva: es la misma suscripción, no una nueva.
    this.db.pushSubscriptions.set(subscription.endpoint, {
      ...subscription,
      createdAt: existing?.createdAt ?? subscription.createdAt,
    });
  }

  async listForUsers(userIds: readonly UserId[]): Promise<PushSubscription[]> {
    const wanted = new Set(userIds.map(String));
    return [...this.db.pushSubscriptions.values()].filter((entry) =>
      wanted.has(String(entry.userId)),
    );
  }

  async listForUser(userId: UserId): Promise<PushSubscription[]> {
    return [...this.db.pushSubscriptions.values()].filter((entry) => entry.userId === userId);
  }

  async remove(endpoint: string): Promise<void> {
    this.db.pushSubscriptions.delete(endpoint);
  }

  async removeMany(endpoints: readonly string[]): Promise<void> {
    for (const endpoint of endpoints) this.db.pushSubscriptions.delete(endpoint);
  }

  async markNotified(endpoints: readonly string[], at: Date): Promise<void> {
    for (const endpoint of endpoints) {
      const entry = this.db.pushSubscriptions.get(endpoint);
      if (entry) this.db.pushSubscriptions.set(endpoint, { ...entry, lastNotifiedAt: at });
    }
  }
}
