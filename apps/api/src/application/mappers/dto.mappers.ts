import { getPaymentMethod } from '@vivo/config';
import type {
  LiveMessage,
  LiveSession,
  Order,
  Product,
  Store,
  User,
} from '@vivo/domain';
import {
  discountPercent,
  priceFrom,
  ratingStars,
  totalStock,
  variantLabel,
} from '@vivo/domain';
import type {
  LiveDetailDto,
  LiveMessageDto,
  LiveSummaryDto,
  OrderDto,
  ProductDetailDto,
  ProductSummaryDto,
  StoreDetailDto,
  StoreSummaryDto,
  UserDto,
} from '@vivo/shared';

/**
 * Domain objects to transport objects.
 *
 * Two rules hold everywhere in this file: dates become ISO strings, and money
 * stays an integer in minor units. Nothing here reads a repository — mappers
 * receive everything they need as arguments, which keeps them trivially
 * testable and keeps N+1 queries impossible to write by accident.
 */

export function toUserDto(user: User): UserDto {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    country: user.country,
    roles: [...user.roles],
    createdAt: user.createdAt.toISOString(),
  };
}

export interface StoreContext {
  readonly isFollowing?: boolean;
  readonly isLiveNow?: boolean;
}

export function toStoreSummaryDto(store: Store, context: StoreContext = {}): StoreSummaryDto {
  return {
    id: String(store.id),
    name: store.name,
    slug: store.slug,
    category: store.category,
    logoUrl: store.logoUrl,
    coverUrl: store.coverUrl,
    city: store.city,
    country: store.country,
    currency: store.currency,
    rating: ratingStars(store.reputation),
    reviewCount: store.reputation.reviewCount,
    followerCount: store.followerCount,
    status: store.status,
    ...(context.isFollowing === undefined ? {} : { isFollowing: context.isFollowing }),
    ...(context.isLiveNow === undefined ? {} : { isLiveNow: context.isLiveNow }),
  };
}

export function toStoreDetailDto(store: Store, context: StoreContext = {}): StoreDetailDto {
  return {
    ...toStoreSummaryDto(store, context),
    description: store.description,
    ownerId: String(store.ownerId),
    salesCount: store.reputation.salesCount,
    deliveryMethodIds: [...store.settings.deliveryMethodIds],
    freeShippingThresholdMinor: store.settings.freeShippingThresholdMinor,
    pickupInstructions: store.settings.pickupInstructions,
    acceptsReturns: store.settings.acceptsReturns,
    createdAt: store.createdAt.toISOString(),
  };
}

export function toProductSummaryDto(product: Product, store: Store): ProductSummaryDto {
  return {
    id: String(product.id),
    storeId: String(product.storeId),
    storeName: store.name,
    storeSlug: store.slug,
    title: product.title,
    priceMinor: priceFrom(product).amountMinor,
    compareAtPriceMinor: product.compareAtPriceMinor,
    discountPercent: discountPercent(product),
    currency: product.currency,
    image: product.images[0] ?? null,
    stock: totalStock(product),
    status: product.status,
  };
}

export function toProductDetailDto(product: Product, store: Store): ProductDetailDto {
  return {
    ...toProductSummaryDto(product, store),
    description: product.description,
    images: product.images.map((image) => ({ ...image })),
    options: product.options.map((option) => ({ name: option.name, values: [...option.values] })),
    variants: product.variants.map((variant) => ({
      id: String(variant.id),
      optionValues: { ...variant.optionValues },
      label: variantLabel(variant),
      sku: variant.sku,
      priceMinor: variant.priceMinor ?? product.basePriceMinor,
      stock: variant.stock,
      active: variant.active,
    })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export interface LiveContext {
  readonly store: Store;
  readonly products: readonly Product[];
  /** Live counters merged from the presence store. */
  readonly viewerCount: number;
  readonly likeCount: number;
  readonly isFollowing?: boolean;
}

export function toLiveSummaryDto(session: LiveSession, context: LiveContext): LiveSummaryDto {
  const featured = context.products.find(
    (product) => String(product.id) === String(session.featuredProductId),
  );

  return {
    id: String(session.id),
    title: session.title,
    status: session.status,
    thumbnailUrl: session.thumbnailUrl,
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    viewerCount: context.viewerCount,
    likeCount: context.likeCount,
    productCount: session.products.length,
    store: toStoreSummaryDto(context.store, {
      ...(context.isFollowing === undefined ? {} : { isFollowing: context.isFollowing }),
      isLiveNow: session.status === 'live',
    }),
    featuredProduct: featured ? toProductSummaryDto(featured, context.store) : null,
  };
}

export function toLiveDetailDto(session: LiveSession, context: LiveContext): LiveDetailDto {
  // Preserve the order the seller arranged rather than repository order.
  const positionOf = new Map(
    session.products.map((entry) => [String(entry.productId), entry.position]),
  );
  const ordered = [...context.products].sort(
    (a, b) => (positionOf.get(String(a.id)) ?? 0) - (positionOf.get(String(b.id)) ?? 0),
  );

  return {
    ...toLiveSummaryDto(session, context),
    peakViewerCount: Math.max(session.peakViewerCount, context.viewerCount),
    // Channel id and provider are safe to expose; the token never is, and is
    // minted per participant by a separate endpoint.
    channel: session.channel
      ? { provider: session.channel.provider, channelId: session.channel.channelId }
      : null,
    products: ordered.map((product) => toProductSummaryDto(product, context.store)),
    featuredProductId: session.featuredProductId ? String(session.featuredProductId) : null,
  };
}

export function toMessageDto(message: LiveMessage): LiveMessageDto {
  return {
    id: String(message.id),
    liveSessionId: String(message.liveSessionId),
    authorId: message.authorId ? String(message.authorId) : null,
    authorName: message.authorName,
    authorAvatarUrl: message.authorAvatarUrl,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toOrderDto(order: Order, store: Store): OrderDto {
  const paymentMethod = getPaymentMethod(store.country, order.payment.methodId);

  return {
    id: String(order.id),
    code: order.code,
    buyerId: String(order.buyerId),
    store: toStoreSummaryDto(store),
    liveSessionId: order.liveSessionId ? String(order.liveSessionId) : null,
    items: order.items.map((item) => ({
      productId: String(item.productId),
      variantId: String(item.variantId),
      title: item.titleSnapshot,
      variantLabel: item.variantLabelSnapshot,
      imageUrl: item.imageUrlSnapshot,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      subtotalMinor: item.subtotalMinor,
      taxCategory: item.taxCategory,
      taxRateBps: item.taxRateBps,
      taxAmountMinor: item.taxAmountMinor,
    })),
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    tax: order.tax,
    totalMinor: order.totalMinor,
    status: order.status,
    payment: {
      methodId: order.payment.methodId,
      provider: order.payment.provider,
      label: paymentMethod?.label ?? order.payment.provider,
      status: order.payment.status,
      installments: order.payment.installments,
      reference: order.payment.reference,
      paidAt: order.payment.paidAt?.toISOString() ?? null,
    },
    delivery: {
      methodId: order.delivery.methodId,
      kind: order.delivery.kind,
      label: order.delivery.label,
      estimate: order.delivery.estimate,
      address: order.delivery.address
        ? {
            ...order.delivery.address,
            id: order.delivery.address.id ? String(order.delivery.address.id) : null,
          }
        : null,
      trackingCode: order.delivery.trackingCode,
    },
    buyerNote: order.buyerNote,
    timeline: order.timeline.map((event) => ({
      status: event.status,
      at: event.at.toISOString(),
      note: event.note,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
