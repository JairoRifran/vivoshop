import type {
  AuthProvider,
  Follow,
  LiveMessage,
  LiveSession,
  LiveSessionId,
  LiveStatus,
  Order,
  OrderId,
  OrderStatus,
  Product,
  ProductId,
  ProductStatus,
  PushDeliveryType,
  PushSubscription,
  Store,
  StoreCategory,
  StoreId,
  User,
  UserId,
  UserIdentity,
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
  /**
   * `passwordHash` es null para una cuenta que solo se abre con un proveedor.
   *
   * El login por contrasena tiene que leer ese null como credenciales
   * invalidas --nunca como "no hace falta contrasena"--.
   */
  create(user: User, passwordHash: string | null): Promise<User>;
  update(user: User): Promise<User>;
}

/**
 * El `state` del ingreso social, en vuelo.
 *
 * Se emite antes de mandar a la persona al proveedor y se consume **una sola
 * vez** al volver: sin eso, un `state` reutilizable deja de proteger contra
 * CSRF, que es lo unico para lo que existe.
 */
export interface LoginState {
  readonly state: string;
  readonly provider: AuthProvider;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface LoginStateRepository {
  create(state: LoginState): Promise<void>;
  /** Devuelve el estado y lo marca usado, o null si no existe/vencio/ya se uso. */
  consume(state: string, now: Date): Promise<LoginState | null>;
}

export interface UserIdentityRepository {
  find(provider: AuthProvider, providerUserId: string): Promise<UserIdentity | null>;
  listForUser(userId: UserId): Promise<UserIdentity[]>;
  link(identity: UserIdentity): Promise<UserIdentity>;
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
  /**
   * Quiénes quieren enterarse de que la tienda salió al aire.
   *
   * Devuelve **solo** a quienes tienen `notifyOnLive`. La distinción existía en
   * el dominio desde M01 y los dos drivers la ignoraban: mientras nada se
   * enviaba, daba igual. Con avisos de verdad, no — mandarle a alguien que
   * apagó el aviso es la forma más rápida de que apague la app entera.
   */
  listFollowerIds(storeId: StoreId): Promise<UserId[]>;
  countFollowers(storeId: StoreId): Promise<number>;
  add(follow: Follow): Promise<void>;
  /**
   * Enciende o apaga el aviso de "salió al aire" para un seguidor.
   *
   * Separado de `add` porque son dos intenciones distintas: seguir una tienda y
   * querer que te interrumpan cuando transmite. Mezclarlas obligaría a mandar
   * la preferencia en cada `follow`, y a decidir qué pasa cuando no viene.
   */
  setNotifyOnLive(userId: UserId, storeId: StoreId, notify: boolean): Promise<void>;
  /** La preferencia actual, o `null` si no sigue la tienda. */
  notifyOnLive(userId: UserId, storeId: StoreId): Promise<boolean | null>;
  remove(userId: UserId, storeId: StoreId): Promise<void>;
}

/**
 * Dónde viven los navegadores suscritos.
 *
 * La identidad es el `endpoint`, así que guardar es siempre un upsert: el mismo
 * navegador volviendo a suscribirse actualiza su fila en vez de crear otra. Ver
 * `PushSubscription` en el dominio.
 */
export interface PushSubscriptionRepository {
  save(subscription: PushSubscription): Promise<void>;
  /** Los destinos de un conjunto de personas, para un envío en lote. */
  listForUsers(userIds: readonly UserId[]): Promise<PushSubscription[]>;
  listForUser(userId: UserId): Promise<PushSubscription[]>;
  /** La baja limpia: se llama cuando el servicio de push dice que ya no existe. */
  remove(endpoint: string): Promise<void>;
  removeMany(endpoints: readonly string[]): Promise<void>;
  markNotified(endpoints: readonly string[], at: Date): Promise<void>;
}

/**
 * La constancia de qué aviso ya se decidió para qué dispositivo.
 *
 * Un solo método, y es el que importa: `reserve` **reclama** los destinos que
 * todavía nadie reclamó y devuelve solo esos. Es un insert con clave compuesta,
 * no un "leer y después escribir": dos réplicas anunciando el mismo vivo
 * compiten y una sola gana cada destino.
 */
export interface PushDeliveryRepository {
  /**
   * Reserva los envíos que faltan y devuelve cuáles quedaron reservados.
   *
   * Lo que **no** vuelve son los que otro ya reservó. Llamarlo dos veces con
   * los mismos argumentos devuelve la lista completa la primera vez y vacía la
   * segunda, y esa asimetría es toda la idempotencia.
   */
  reserve(input: {
    liveSessionId: LiveSessionId;
    endpoints: readonly string[];
    type: PushDeliveryType;
    at: Date;
  }): Promise<string[]>;
  /** Cuántos avisos de ese tipo se decidieron para un vivo. Para pruebas y soporte. */
  countFor(liveSessionId: LiveSessionId, type: PushDeliveryType): Promise<number>;
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
