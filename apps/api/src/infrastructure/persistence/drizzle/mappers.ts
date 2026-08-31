import type { CountryCode, CurrencyCode } from '@vivo/config';
import type { TaxSnapshot } from '@vivo/domain';
import type {
  Follow,
  LiveMessage,
  LiveSession,
  LiveStatus,
  Order,
  OrderDelivery,
  OrderEvent,
  OrderItem,
  OrderPayment,
  OrderStatus,
  Product,
  ProductStatus,
  ProductVariant,
  Store,
  StoreCategory,
  StoreSettings,
  StoreStatus,
  User,
  UserRole,
  UserStatus,
} from '@vivo/domain';
import {
  asBidId,
  asLiveSessionId,
  asMessageId,
  asOrderId,
  asProductId,
  asStoreId,
  asUserId,
  asVariantId,
} from '@vivo/domain';
import type { InferSelectModel } from 'drizzle-orm';
import type {
  follows,
  liveMessages,
  liveSessionProducts,
  liveSessions,
  orderItems,
  orders,
  productVariants,
  products,
  stores,
  users,
} from './schema';

/**
 * Row ↔ domain translation.
 *
 * This is the only file allowed to know that the domain's `Money` is two
 * integer columns, or that a status is a text column rather than a union.
 * Keeping the casts here means a schema change never leaks into a use case.
 */

type UserRow = InferSelectModel<typeof users>;
type StoreRow = InferSelectModel<typeof stores>;
type ProductRow = InferSelectModel<typeof products>;
type VariantRow = InferSelectModel<typeof productVariants>;
type LiveRow = InferSelectModel<typeof liveSessions>;
type LiveProductRow = InferSelectModel<typeof liveSessionProducts>;
type MessageRow = InferSelectModel<typeof liveMessages>;
type OrderRow = InferSelectModel<typeof orders>;
type OrderItemRow = InferSelectModel<typeof orderItems>;
type FollowRow = InferSelectModel<typeof follows>;

export function toUser(row: UserRow): User {
  return {
    id: asUserId(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    country: row.country as CountryCode,
    roles: row.roles as UserRole[],
    status: row.status as UserStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromUser(user: User, passwordHash: string | null) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    passwordHash,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    country: user.country,
    roles: [...user.roles],
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toStore(row: StoreRow): Store {
  return {
    id: asStoreId(row.id),
    ownerId: asUserId(row.ownerId),
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category as StoreCategory,
    logoUrl: row.logoUrl,
    coverUrl: row.coverUrl,
    country: row.country as CountryCode,
    currency: row.currency as CurrencyCode,
    city: row.city,
    reputation: {
      ratingBps: row.ratingBps,
      reviewCount: row.reviewCount,
      salesCount: row.salesCount,
    },
    followerCount: row.followerCount,
    verification: row.verificationStatus as Store['verification'],
    status: row.status as StoreStatus,
    settings: row.settings as unknown as StoreSettings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromStore(store: Store) {
  return {
    id: String(store.id),
    ownerId: String(store.ownerId),
    name: store.name,
    slug: store.slug,
    description: store.description,
    category: store.category,
    logoUrl: store.logoUrl,
    coverUrl: store.coverUrl,
    country: store.country,
    currency: store.currency,
    city: store.city,
    ratingBps: store.reputation.ratingBps,
    reviewCount: store.reputation.reviewCount,
    salesCount: store.reputation.salesCount,
    followerCount: store.followerCount,
    verificationStatus: store.verification,
    status: store.status,
    settings: store.settings as unknown as Record<string, unknown>,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

export function toProduct(row: ProductRow, variantRows: VariantRow[]): Product {
  const variants: ProductVariant[] = [...variantRows]
    .sort((a, b) => a.position - b.position)
    .map((variant) => ({
      id: asVariantId(variant.id),
      optionValues: variant.optionValues,
      sku: variant.sku,
      priceMinor: variant.priceMinor,
      stock: variant.stock,
      active: variant.active,
    }));

  return {
    id: asProductId(row.id),
    storeId: asStoreId(row.storeId),
    title: row.title,
    description: row.description,
    basePriceMinor: row.basePriceMinor,
    compareAtPriceMinor: row.compareAtPriceMinor,
    currency: row.currency as CurrencyCode,
    images: row.images,
    options: row.options,
    variants,
    status: row.status as ProductStatus,
    taxCategory: row.taxCategory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromProduct(product: Product) {
  return {
    id: String(product.id),
    storeId: String(product.storeId),
    title: product.title,
    description: product.description,
    basePriceMinor: product.basePriceMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    currency: product.currency,
    images: product.images.map((image) => ({ ...image })),
    options: product.options.map((option) => ({ name: option.name, values: [...option.values] })),
    status: product.status,
    taxCategory: product.taxCategory,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function fromVariants(product: Product) {
  return product.variants.map((variant, position) => ({
    id: String(variant.id),
    productId: String(product.id),
    optionValues: { ...variant.optionValues },
    sku: variant.sku,
    priceMinor: variant.priceMinor,
    stock: variant.stock,
    active: variant.active,
    position,
  }));
}

export function toLiveSession(row: LiveRow, productRows: LiveProductRow[]): LiveSession {
  return {
    id: asLiveSessionId(row.id),
    storeId: asStoreId(row.storeId),
    title: row.title,
    status: row.status as LiveStatus,
    thumbnailUrl: row.thumbnailUrl,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    viewerCount: row.viewerCount,
    peakViewerCount: row.peakViewerCount,
    likeCount: row.likeCount,
    products: [...productRows]
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({
        productId: asProductId(entry.productId),
        position: entry.position,
        soldCount: entry.soldCount,
      })),
    featuredProductId: row.featuredProductId ? asProductId(row.featuredProductId) : null,
    // Provider and id travel together or not at all: half a channel is not a
    // channel, and treating it as one would hand the client a token request
    // that can never succeed.
    channel:
      row.channelProvider && row.channelId
        ? { provider: row.channelProvider, channelId: row.channelId, url: row.channelUrl }
        : null,
    interruptedAt: row.interruptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromLiveSession(session: LiveSession) {
  return {
    id: String(session.id),
    storeId: String(session.storeId),
    title: session.title,
    status: session.status,
    thumbnailUrl: session.thumbnailUrl,
    scheduledAt: session.scheduledAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    viewerCount: session.viewerCount,
    peakViewerCount: session.peakViewerCount,
    likeCount: session.likeCount,
    featuredProductId: session.featuredProductId ? String(session.featuredProductId) : null,
    channelProvider: session.channel?.provider ?? null,
    channelId: session.channel?.channelId ?? null,
    channelUrl: session.channel?.url ?? null,
    interruptedAt: session.interruptedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function fromLiveProducts(session: LiveSession) {
  return session.products.map((entry) => ({
    liveSessionId: String(session.id),
    productId: String(entry.productId),
    position: entry.position,
    soldCount: entry.soldCount,
  }));
}

export function toMessage(row: MessageRow): LiveMessage {
  return {
    id: asMessageId(row.id),
    liveSessionId: asLiveSessionId(row.liveSessionId),
    authorId: row.authorId ? asUserId(row.authorId) : null,
    authorName: row.authorName,
    authorAvatarUrl: row.authorAvatarUrl,
    kind: row.kind as LiveMessage['kind'],
    body: row.body,
    createdAt: row.createdAt,
  };
}

export function fromMessage(message: LiveMessage) {
  return {
    id: String(message.id),
    liveSessionId: String(message.liveSessionId),
    authorId: message.authorId ? String(message.authorId) : null,
    authorName: message.authorName,
    authorAvatarUrl: message.authorAvatarUrl,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt,
  };
}

export function toOrder(row: OrderRow, itemRows: OrderItemRow[]): Order {
  const items: OrderItem[] = [...itemRows]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      productId: asProductId(item.productId),
      variantId: asVariantId(item.variantId),
      titleSnapshot: item.titleSnapshot,
      variantLabelSnapshot: item.variantLabelSnapshot,
      imageUrlSnapshot: item.imageUrlSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      priceSource: item.priceSource as OrderItem['priceSource'],
      bidId: item.bidId ? asBidId(item.bidId) : null,
      quantity: item.quantity,
      subtotalMinor: item.subtotalMinor,
      taxCategory: item.taxCategory,
      taxRateBps: item.taxRateBps,
      taxAmountMinor: item.taxAmountMinor,
    }));

  const payment = row.payment as unknown as OrderPayment & { paidAt: string | null };
  const delivery = row.delivery as unknown as OrderDelivery;

  const timeline: OrderEvent[] = (
    row.timeline as unknown as Array<{ status: OrderStatus; at: string; note: string | null }>
  ).map((event) => ({ status: event.status, at: new Date(event.at), note: event.note }));

  return {
    id: asOrderId(row.id),
    code: row.code,
    buyerId: asUserId(row.buyerId),
    storeId: asStoreId(row.storeId),
    liveSessionId: row.liveSessionId ? asLiveSessionId(row.liveSessionId) : null,
    items,
    currency: row.currency as CurrencyCode,
    subtotalMinor: row.subtotalMinor,
    shippingMinor: row.shippingMinor,
    discountMinor: row.discountMinor,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    tax: {
      treatment: row.taxTreatment as TaxSnapshot['treatment'],
      rateBps: row.taxRateBps,
      amountMinor: row.taxMinor,
      label: row.taxLabel,
      category: row.taxCategory,
    },
    status: row.status as OrderStatus,
    protection: row.protectionStatus as Order['protection'],
    payment: { ...payment, paidAt: payment.paidAt ? new Date(payment.paidAt) : null },
    delivery,
    buyerNote: row.buyerNote,
    timeline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromOrder(order: Order) {
  return {
    id: String(order.id),
    code: order.code,
    buyerId: String(order.buyerId),
    storeId: String(order.storeId),
    liveSessionId: order.liveSessionId ? String(order.liveSessionId) : null,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    taxTreatment: order.tax.treatment,
    taxRateBps: order.tax.rateBps,
    taxCategory: order.tax.category,
    taxLabel: order.tax.label,
    totalMinor: order.totalMinor,
    status: order.status,
    protectionStatus: order.protection,
    payment: {
      ...order.payment,
      paidAt: order.payment.paidAt ? order.payment.paidAt.toISOString() : null,
    } as unknown as Record<string, unknown>,
    delivery: order.delivery as unknown as Record<string, unknown>,
    buyerNote: order.buyerNote,
    timeline: order.timeline.map((event) => ({
      status: event.status,
      at: event.at.toISOString(),
      note: event.note,
    })) as unknown as Array<Record<string, unknown>>,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function fromOrderItems(order: Order) {
  return order.items.map((item, position) => ({
    orderId: String(order.id),
    position,
    productId: String(item.productId),
    variantId: String(item.variantId),
    titleSnapshot: item.titleSnapshot,
    variantLabelSnapshot: item.variantLabelSnapshot,
    imageUrlSnapshot: item.imageUrlSnapshot,
    unitPriceMinor: item.unitPriceMinor,
    priceSource: item.priceSource,
    bidId: item.bidId ? String(item.bidId) : null,
    quantity: item.quantity,
    subtotalMinor: item.subtotalMinor,
    taxCategory: item.taxCategory,
    taxRateBps: item.taxRateBps,
    taxAmountMinor: item.taxAmountMinor,
  }));
}

export function toFollow(row: FollowRow): Follow {
  return {
    userId: asUserId(row.userId),
    storeId: asStoreId(row.storeId),
    notifyOnLive: row.notifyOnLive,
    createdAt: row.createdAt,
  };
}
