import type {
  Follow,
  LiveMessage,
  LiveSession,
  LiveStatus,
  Order,
  OrderStatus,
  Product,
  ProductStatus,
  Store,
  StoreCategory,
  User,
  UserId,
  StoreId,
  ProductId,
  LiveSessionId,
  OrderId,
} from '@vivo/domain';

/**
 * Persistence ports. The application layer depends only on these; whether the
 * rows live in Postgres or in a Map is an infrastructure detail chosen by
 * `DATA_DRIVER` at boot.
 *
 * Credentials are deliberately separated from `User`: the domain model has no
 * business knowing a password hash exists.
 */
export interface StoredCredentials {
  readonly userId: UserId;
  readonly passwordHash: string;
}

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findCredentialsByEmail(email: string): Promise<StoredCredentials | null>;
  create(user: User, passwordHash: string): Promise<User>;
  update(user: User): Promise<User>;
}

export interface StoreQuery {
  readonly category?: StoreCategory;
  readonly search?: string;
  readonly limit?: number;
}

export interface StoreRepository {
  findById(id: StoreId): Promise<Store | null>;
  findBySlug(slug: string): Promise<Store | null>;
  findByOwner(ownerId: UserId): Promise<Store | null>;
  list(query?: StoreQuery): Promise<Store[]>;
  listByIds(ids: readonly StoreId[]): Promise<Store[]>;
  slugExists(slug: string): Promise<boolean>;
  create(store: Store): Promise<Store>;
  update(store: Store): Promise<Store>;
}

export interface ProductQuery {
  readonly storeId?: StoreId;
  readonly status?: ProductStatus;
  readonly search?: string;
  readonly limit?: number;
}

export interface ProductRepository {
  findById(id: ProductId): Promise<Product | null>;
  listByIds(ids: readonly ProductId[]): Promise<Product[]>;
  list(query?: ProductQuery): Promise<Product[]>;
  create(product: Product): Promise<Product>;
  update(product: Product): Promise<Product>;
}

export interface LiveQuery {
  readonly status?: LiveStatus;
  readonly storeId?: StoreId;
  readonly limit?: number;
}

export interface LiveRepository {
  findById(id: LiveSessionId): Promise<LiveSession | null>;
  list(query?: LiveQuery): Promise<LiveSession[]>;
  create(session: LiveSession): Promise<LiveSession>;
  update(session: LiveSession): Promise<LiveSession>;
}

export interface MessageRepository {
  listBySession(id: LiveSessionId, limit?: number): Promise<LiveMessage[]>;
  create(message: LiveMessage): Promise<LiveMessage>;
}

export interface OrderQuery {
  readonly buyerId?: UserId;
  readonly storeId?: StoreId;
  readonly status?: OrderStatus;
  readonly liveSessionId?: LiveSessionId;
  readonly limit?: number;
}

export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  list(query?: OrderQuery): Promise<Order[]>;
  create(order: Order): Promise<Order>;
  update(order: Order): Promise<Order>;
}

export interface FollowRepository {
  exists(userId: UserId, storeId: StoreId): Promise<boolean>;
  listStoreIds(userId: UserId): Promise<StoreId[]>;
  /** Everyone following a store, used to announce that it went live. */
  listFollowerIds(storeId: StoreId): Promise<UserId[]>;
  countFollowers(storeId: StoreId): Promise<number>;
  add(follow: Follow): Promise<void>;
  remove(userId: UserId, storeId: StoreId): Promise<void>;
}

export interface StoredAnalyticsEvent {
  readonly id: string;
  readonly name: string;
  readonly userId: UserId | null;
  readonly properties: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface AnalyticsRepository {
  record(event: StoredAnalyticsEvent): Promise<void>;
  /** Used by the seller dashboard and by tests; not a general query surface. */
  countByName(name: string, since: Date): Promise<number>;
}
