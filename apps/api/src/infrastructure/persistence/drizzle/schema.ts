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
    passwordHash: text('password_hash').notNull(),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    country: text('country').notNull().default('UY'),
    /** Additive: a single account can hold both `buyer` and `seller`. */
    roles: jsonb('roles').$type<string[]>().notNull().default(['buyer']),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

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

export const schema = {
  users,
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
};

export type Schema = typeof schema;
