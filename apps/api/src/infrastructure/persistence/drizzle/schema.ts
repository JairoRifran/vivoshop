import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * PostgreSQL schema.
 *
 * The modelling rule, applied consistently: anything queried, joined or
 * mutated on its own gets columns and a table; anything that is only ever read
 * alongside its parent, and is an immutable snapshot, is JSONB.
 *
 * So `product_variants` is a real table — stock is decremented per variant,
 * concurrently, during a live — while a product's images and an order's
 * timeline are JSONB, because nothing ever selects an image without its
 * product or a timeline entry without its order.
 *
 * Enums are stored as text with an application-level union rather than
 * Postgres enums: adding an order status should be a deploy, not a migration
 * with a table lock.
 */

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    /**
     * Opcional desde M07: quien entra con Google nunca eligio una.
     *
     * Null significa "esta cuenta no se abre con contrasena", y el login por
     * contrasena tiene que tratarlo como credenciales invalidas --nunca como
     * "no hace falta contrasena", que seria dejar la puerta abierta.
     */
    passwordHash: text('password_hash'),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    /**
     * Cuando se cambio la contrasena por ultima vez. Null si nunca.
     *
     * Es la fecha de corte de las sesiones: un JWT emitido antes de esto esta
     * muerto. Sin eso, cambiar la contrasena para echar a alguien que entro no
     * lo echa --sigue adentro hasta que su token venza solo--. Ver
     * `isSessionStillValid`.
     */
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    country: text('country').notNull().default('UY'),
    /** Additive: a single account can hold both `buyer` and `seller`. */
    roles: jsonb('roles').$type<string[]>().notNull().default(['buyer']),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

/**
 * Las formas de entrar a una cuenta.
 *
 * Una persona, muchas identidades. La clave primaria es (proveedor, id del
 * proveedor) porque eso es lo que identifica de verdad: una cuenta de Google
 * apunta a exactamente un usuario de VivoShop, para siempre, aunque su dueno
 * cambie de email.
 *
 * El unico por (usuario, proveedor) cierra la otra direccion: una cuenta no
 * puede tener dos Google distintos colgando.
 */
/**
 * Permisos para elegir una contrasena nueva.
 *
 * La clave primaria es el **hash** del token, no el token. El token viaja por
 * email y vive en el buzon de la persona; aca solo queda su huella. Si la base
 * se filtra, lo que el atacante encuentra no abre ninguna cuenta.
 */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const userIdentities = pgTable(
  'user_identities',
  {
    provider: text('provider').notNull(),
    /** `sub` en Google. Estable de por vida; **no** es el email. */
    providerUserId: text('provider_user_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Lo que el proveedor dijo al vincular. Se guarda para poder auditar. */
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerUserId] }),
    uniqueIndex('user_identities_user_provider_idx').on(table.userId, table.provider),
  ],
);

/**
 * El `state` anti-CSRF del ingreso social.
 *
 * Tabla aparte de `oauth_states` --el de Mercado Pago-- y no es duplicacion:
 * aquel cuelga de una tienda, y acá todavía no hay ni sesion. Forzar los dos
 * en una tabla obligaria a hacer `store_id` nullable, que es perder una
 * invariante buena de M03 para ahorrar cinco lineas.
 *
 * `code_verifier` es el PKCE. Vive del lado del servidor y nunca viaja: es lo
 * que hace que un codigo de autorizacion interceptado no sirva para nada.
 */
export const loginStates = pgTable('login_states', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  /** Ruta **relativa** a la que volver. Ver `safeReturnPath`. */
  returnTo: text('return_to').notNull().default('/'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const stores = pgTable(
  'stores',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('otros'),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    country: text('country').notNull().default('UY'),
    currency: text('currency').notNull().default('UYU'),
    city: text('city'),
    /** 0–500, so 4.8 stars is 480. Integer keeps averages exact. */
    ratingBps: integer('rating_bps').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    salesCount: integer('sales_count').notNull().default(0),
    followerCount: integer('follower_count').notNull().default(0),
    /**
     * Copia del estado de `business_verifications`.
     *
     * Denormalizado porque el ✓ se dibuja en cada grilla y resolverlo con un
     * join por tienda sería pagar una consulta por un adorno. La fila de
     * verificación sigue siendo la fuente de verdad.
     */
    verificationStatus: text('verification_status').notNull().default('unverified'),
    status: text('status').notNull().default('active'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stores_slug_idx').on(table.slug),
    index('stores_owner_idx').on(table.ownerId),
    index('stores_category_idx').on(table.category),
  ],
);

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** Integer minor units. No floats ever touch money. */
    basePriceMinor: integer('base_price_minor').notNull(),
    compareAtPriceMinor: integer('compare_at_price_minor'),
    currency: text('currency').notNull().default('UYU'),
    images: jsonb('images').$type<Array<{ url: string; alt: string }>>().notNull().default([]),
    options: jsonb('options')
      .$type<Array<{ name: string; values: string[] }>>()
      .notNull()
      .default([]),
    status: text('status').notNull().default('active'),
    /** Null means the market default rate. See `@vivo/domain/services/tax`. */
    taxCategory: text('tax_category'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('products_store_idx').on(table.storeId),
    index('products_status_idx').on(table.status),
  ],
);

/**
 * A real table, not JSONB: `stock` is decremented on every purchase, and two
 * buyers hitting the same variant during a live must not clobber each other.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    optionValues: jsonb('option_values').$type<Record<string, string>>().notNull().default({}),
    sku: text('sku'),
    priceMinor: integer('price_minor'),
    stock: integer('stock').notNull().default(0),
    active: boolean('active').notNull().default(true),
    position: integer('position').notNull().default(0),
  },
  (table) => [index('variants_product_idx').on(table.productId)],
);

export const liveSessions = pgTable(
  'live_sessions',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('scheduled'),
    thumbnailUrl: text('thumbnail_url'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    viewerCount: integer('viewer_count').notNull().default(0),
    peakViewerCount: integer('peak_viewer_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    featuredProductId: text('featured_product_id'),
    /**
     * The room the StreamingProvider opened for this session.
     *
     * Three columns rather than one JSON blob: the provider key is what tells
     * us whether a stored channel is still meaningful after a vendor change,
     * and querying it is worth more than the flexibility of jsonb here. All
     * three are null until the session actually starts.
     */
    channelProvider: text('channel_provider'),
    channelId: text('channel_id'),
    channelUrl: text('channel_url'),
    /** Set when the broadcaster drops; cleared when they come back. */
    interruptedAt: timestamp('interrupted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('live_store_idx').on(table.storeId),
    index('live_status_idx').on(table.status),
    index('live_scheduled_idx').on(table.scheduledAt),
  ],
);

/** Join table: which products a session shows, in which order, and units sold. */
export const liveSessionProducts = pgTable(
  'live_session_products',
  {
    liveSessionId: text('live_session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    soldCount: integer('sold_count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.liveSessionId, table.productId] }),
    index('live_products_session_idx').on(table.liveSessionId),
  ],
);

export const liveMessages = pgTable(
  'live_messages',
  {
    id: text('id').primaryKey(),
    liveSessionId: text('live_session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    authorAvatarUrl: text('author_avatar_url'),
    kind: text('kind').notNull().default('chat'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_session_created_idx').on(table.liveSessionId, table.createdAt)],
);

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    /** Attribution: which broadcast produced the sale. */
    liveSessionId: text('live_session_id').references(() => liveSessions.id, {
      onDelete: 'set null',
    }),
    currency: text('currency').notNull().default('UYU'),
    subtotalMinor: integer('subtotal_minor').notNull(),
    shippingMinor: integer('shipping_minor').notNull().default(0),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    /** Snapshot of the rule the order was charged under, never recomputed. */
    taxTreatment: text('tax_treatment').notNull().default('included'),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    taxCategory: text('tax_category').notNull().default('standard'),
    taxLabel: text('tax_label').notNull().default('IVA'),
    totalMinor: integer('total_minor').notNull(),
    status: text('status').notNull().default('pending_payment'),
    /** Eje de Compra Protegida. Ver `@vivo/domain/entities/protection`. */
    protectionStatus: text('protection_status').notNull().default('not_applicable'),
    payment: jsonb('payment').$type<Record<string, unknown>>().notNull(),
    delivery: jsonb('delivery').$type<Record<string, unknown>>().notNull(),
    buyerNote: text('buyer_note'),
    timeline: jsonb('timeline').$type<Array<Record<string, unknown>>>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_code_idx').on(table.code),
    index('orders_buyer_idx').on(table.buyerId, table.createdAt),
    index('orders_store_idx').on(table.storeId, table.status),
    index('orders_live_idx').on(table.liveSessionId),
  ],
);

/**
 * Immutable line snapshots. A five-year-old order must render exactly as it
 * did, even if the product was renamed, repriced or deleted.
 */
export const orderItems = pgTable(
  'order_items',
  {
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    variantLabelSnapshot: text('variant_label_snapshot').notNull().default(''),
    imageUrlSnapshot: text('image_url_snapshot'),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    /** De dónde salió el precio: catálogo, u oferta aceptada. */
    priceSource: text('price_source').notNull().default('catalog'),
    /** Qué oferta lo fijó, cuando `price_source` es `accepted_bid`. */
    bidId: text('bid_id'),
    quantity: integer('quantity').notNull(),
    subtotalMinor: integer('subtotal_minor').notNull(),
    /** Per-line tax snapshot, so a mixed-rate order stays auditable. */
    taxCategory: text('tax_category').notNull().default('standard'),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    taxAmountMinor: integer('tax_amount_minor').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.position] })],
);

export const follows = pgTable(
  'follows',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    notifyOnLive: boolean('notify_on_live').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.storeId] }),
    index('follows_store_idx').on(table.storeId),
  ],
);

/**
 * Consumed idempotency keys.
 *
 * The composite primary key is the whole mechanism: two concurrent order
 * creations with the same key both try to insert this row, and PostgreSQL
 * makes the second one wait. If the first commits, the second sees the row and
 * replays its result; if the first rolls back, the row vanishes and the second
 * proceeds. No advisory locks, no polling, no application-level coordination.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** `operation:actorId`, so two endpoints can never collide on one key. */
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Canonical fingerprint of the payload; a mismatch is a conflict. */
    requestHash: text('request_hash').notNull(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index('idempotency_created_idx').on(table.createdAt),
  ],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('analytics_name_time_idx').on(table.name, table.occurredAt)],
);

// --- Pagos y confianza (M03) -------------------------------------------------

/**
 * Un cobro, con el reparto congelado.
 *
 * Tabla propia y no columnas en `orders` porque un pago no siempre pertenece a
 * un pedido: promocionar un vivo va a cobrarse por el mismo circuito, y
 * entonces `order_id` queda nulo.
 */
export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull().default('order'),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    payerId: text('payer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('pending'),
    currency: text('currency').notNull(),
    // El reparto se guarda tal como se aplicó. Si mañana cambia la comisión,
    // lo cobrado ayer sigue explicándose sin consultar la política vigente.
    grossMinor: integer('gross_minor').notNull(),
    commissionMinor: integer('commission_minor').notNull(),
    commissionRateBps: integer('commission_rate_bps').notNull(),
    commissionPolicy: text('commission_policy').notNull(),
    netMinor: integer('net_minor').notNull(),
    installments: integer('installments').notNull().default(1),
    provider: text('provider').notNull(),
    providerIntentId: text('provider_intent_id'),
    providerPaymentId: text('provider_payment_id'),
    checkoutUrl: text('checkout_url'),
    failureReason: text('failure_reason'),
    /** Liquidación: si el proveedor retiene y si ya se liberó. */
    settlementStatus: text('settlement_status').notNull().default('not_supported'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_order_idx').on(table.orderId),
    index('payments_store_idx').on(table.storeId),
    // El webhook llega con el id del proveedor y nada más: sin este índice,
    // cada aviso sería un scan de la tabla entera.
    index('payments_provider_payment_idx').on(table.provider, table.providerPaymentId),
  ],
);

/**
 * Avisos del proveedor ya procesados.
 *
 * Es lo que vuelve idempotente al webhook. Mercado Pago reintenta, y sin esta
 * tabla un reintento descontaría stock dos veces, cobraría dos comisiones y
 * anunciaría dos ventas. La clave primaria hace el trabajo: insertar gana o
 * falla, y solo quien gana procesa.
 */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    provider: text('provider').notNull(),
    /** Identificador del aviso en el proveedor. */
    eventId: text('event_id').notNull(),
    paymentId: text('payment_id').references(() => payments.id, { onDelete: 'cascade' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventId] })],
);

/** La cuenta con la que cobra cada tienda. Los tokens no salen del servidor. */
export const sellerPaymentAccounts = pgTable(
  'seller_payment_accounts',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('disconnected'),
    externalAccountId: text('external_account_id'),
    externalAccountLabel: text('external_account_label'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.storeId, table.provider] })],
);

/**
 * Navegadores suscritos a los avisos.
 *
 * La clave primaria es el `endpoint` porque **es** la identidad de la
 * suscripción: el mismo navegador volviendo a suscribirse devuelve la misma
 * URL, así que guardar es un upsert y no puede haber dos filas apuntando al
 * mismo destino. Con un id propio, sí podría — y eso significa mandar el aviso
 * dos veces.
 *
 * `on delete cascade` sobre el usuario: si la cuenta se va, sus destinos se van
 * con ella. No hay a quién avisarle.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    endpoint: text('endpoint').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  },
  // El envío a los seguidores de una tienda busca por usuario, siempre.
  (table) => [index('push_subscriptions_user_idx').on(table.userId)],
);

/**
 * Qué aviso ya se decidió para qué dispositivo.
 *
 * La clave primaria compuesta **es** la garantía de idempotencia: reservar es
 * un insert, y si otro proceso ya reservó, el insert no entra. Sobrevive a un
 * reinicio y a dos réplicas anunciando el mismo vivo, que es exactamente lo que
 * una comprobación en memoria no puede hacer.
 *
 * `on delete cascade` desde las dos puntas: si el vivo o el dispositivo
 * desaparecen, la constancia deja de tener sentido.
 */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    liveSessionId: text('live_session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint')
      .notNull()
      .references(() => pushSubscriptions.endpoint, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.liveSessionId, table.endpoint, table.type] })],
);

/**
 * El `state` anti-CSRF del OAuth.
 *
 * Sin esto cualquiera puede inducir a un vendedor a conectar la cuenta de otro
 * a su tienda. Se emite antes de mandar a la persona al proveedor y se consume
 * una sola vez al volver.
 */
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

/**
 * Verificación comercial: la que otorga el ✓.
 *
 * Los datos viven acá y no en `stores` para que sea difícil filtrarlos por
 * accidente en un DTO: hay que salir a buscarlos a propósito.
 */
export const businessVerifications = pgTable(
  'business_verifications',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('unverified'),
    legalName: text('legal_name'),
    taxId: text('tax_id'),
    responsibleName: text('responsible_name'),
    responsibleDocument: text('responsible_document'),
    commercialAddress: text('commercial_address'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewer: text('reviewer'),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Interno: le sirve a soporte, no se expone en ninguna respuesta pública. */
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('business_verification_store_idx').on(table.storeId)],
);

/** Verificación de identidad de una persona. No otorga tick. */
export const identityVerifications = pgTable(
  'identity_verifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('unverified'),
    fullName: text('full_name'),
    documentNumber: text('document_number'),
    documentType: text('document_type'),
    phone: text('phone'),
    email: text('email'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewer: text('reviewer'),
    reviewedBy: text('reviewed_by_user_id'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('identity_verification_user_idx').on(table.userId)],
);

// --- Modo Puja (M04) ---------------------------------------------------------

/**
 * Una puja abierta sobre un producto durante un vivo.
 *
 * Tabla propia y no columnas en `live_session_products` porque una puja tiene
 * ciclo de vida, ganador, reserva y motivo de cierre — y porque un mismo
 * producto puede pujarse más de una vez en el mismo vivo si el vendedor cierra
 * y vuelve a abrir. Como fila aparte, cada intento queda registrado.
 */
export const bidSessions = pgTable(
  'bid_sessions',
  {
    id: text('id').primaryKey(),
    liveSessionId: text('live_session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    sellerId: text('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** El stock vive en la variante: sin esto no hay nada que reservar. */
    variantId: text('variant_id').notNull(),
    status: text('status').notNull().default('open'),
    currency: text('currency').notNull(),
    /** Lo que decía la ficha al abrir. Información, no un piso. */
    referencePriceMinor: integer('reference_price_minor').notNull(),
    minimumBidMinor: integer('minimum_bid_minor'),
    minimumIncrementMinor: integer('minimum_increment_minor'),
    /** La oferta que el vendedor aceptó. Una sola, para siempre. */
    acceptedBidId: text('accepted_bid_id'),
    reservedUntil: timestamp('reserved_until', { withTimezone: true }),
    /** El pedido que salió de la puja. A partir de acá manda el pedido. */
    orderId: text('order_id').references(() => orders.id, { onDelete: 'set null' }),
    closedReason: text('closed_reason'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('bid_sessions_live_idx').on(table.liveSessionId, table.status),
    index('bid_sessions_store_idx').on(table.storeId),
    // El barrido de reservas vencidas pregunta exactamente por esto.
    index('bid_sessions_reserved_idx').on(table.status, table.reservedUntil),
    /**
     * Un producto no puede tener dos pujas abiertas a la vez en el mismo vivo.
     *
     * Parcial —solo sobre `open`— para que cerrar y reabrir siga siendo
     * posible: lo que se prohíbe es que convivan dos abiertas, no que haya
     * historia. Es la base la que lo impide, no un chequeo previo que dos
     * peticiones simultáneas podrían pasar las dos.
     */
    uniqueIndex('bid_sessions_one_open_per_product_idx')
      .on(table.liveSessionId, table.productId)
      .where(sql`status = 'open'`),
  ],
);

/**
 * Una oferta.
 *
 * `buyer_name` y `buyer_avatar_url` se congelan acá en vez de leerse del
 * usuario: la puja es un evento social que se muestra en vivo, y resolver el
 * nombre de cada postor en cada render sería una consulta por línea. Congelarlo
 * además hace que la sala vea lo mismo que vio cuando ocurrió.
 *
 * Solo se guardan tres estados. `outbid` y `lost` se derivan al leer; ver
 * `@vivo/domain/entities/bid`.
 */
export const bids = pgTable(
  'bids',
  {
    id: text('id').primaryKey(),
    bidSessionId: text('bid_session_id')
      .notNull()
      .references(() => bidSessions.id, { onDelete: 'cascade' }),
    buyerId: text('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    buyerName: text('buyer_name').notNull(),
    buyerAvatarUrl: text('buyer_avatar_url'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Buscar la mejor oferta de una sesión es la consulta caliente: ocurre en
    // cada oferta nueva, y bajo el lock de la transacción.
    index('bids_session_amount_idx').on(table.bidSessionId, table.amountMinor, table.createdAt),
    index('bids_buyer_idx').on(table.buyerId),
  ],
);

/** Reclamo del comprador. Declarado, no mediado: M03 deja el estado. */
export const disputes = pgTable('disputes', {
  orderId: text('order_id')
    .primaryKey()
    .references(() => orders.id, { onDelete: 'cascade' }),
  openedBy: text('opened_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  detail: text('detail').notNull().default(''),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// --- Moderación (M14) --------------------------------------------------------

/**
 * Denuncias de contenido.
 *
 * `target` + `target_id` en vez de una columna por tipo: se puede denunciar un
 * mensaje del chat, un producto, una tienda o una cuenta, y agregar un tipo más
 * no debería ser una migración. El precio es que no hay clave foránea hacia lo
 * denunciado —no se puede referenciar cuatro tablas desde una columna—, así que
 * una denuncia puede sobrevivir a lo que denuncia. Es aceptable: la cola de
 * moderación tiene que poder mostrar "esto ya no existe" en vez de perder el
 * registro de que alguien se quejó.
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    target: text('target').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    detail: text('detail').notNull().default(''),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    // La cola de moderación siempre pide lo abierto, de lo más viejo a lo más
    // nuevo: sin este índice es un scan de la tabla entera en cada carga.
    index('reports_status_created_idx').on(table.status, table.createdAt),
    index('reports_target_idx').on(table.target, table.targetId),
  ],
);

/**
 * Quién no quiere ver a quién.
 *
 * Clave primaria compuesta: bloquear dos veces a la misma persona es la misma
 * fila, no dos. Eso hace que el botón sea idempotente sin que la aplicación
 * tenga que comprobar antes de insertar.
 *
 * `cascade` en los dos lados: es una preferencia personal, no un registro que
 * valga conservar cuando alguna de las dos cuentas ya no está.
 */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] })],
);

export const schema = {
  users,
  pushSubscriptions,
  pushDeliveries,
  stores,
  products,
  productVariants,
  liveSessions,
  liveSessionProducts,
  liveMessages,
  orders,
  orderItems,
  follows,
  idempotencyKeys,
  analyticsEvents,
  payments,
  paymentWebhookEvents,
  sellerPaymentAccounts,
  oauthStates,
  userIdentities,
  loginStates,
  passwordResetTokens,
  businessVerifications,
  identityVerifications,
  disputes,
  reports,
  blocks,
  bidSessions,
  bids,
};

export type Schema = typeof schema;
