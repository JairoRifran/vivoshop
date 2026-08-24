import { getPaymentMethod } from '@vivo/config';
import type {
  Dispute,
  LiveMessage,
  LiveSession,
  Order,
  Payment,
  Product,
  SellerPaymentAccountView,
  Store,
  User,
  VerificationStatus,
} from '@vivo/domain';
import {
  discountPercent,
  isVerified,
  priceFrom,
  ratingStars,
  totalStock,
  variantLabel,
} from '@vivo/domain';
import type {
  DisputeDto,
  LiveDetailDto,
  LiveMessageDto,
  LiveSummaryDto,
  OrderDto,
  PaymentDto,
  ProductDetailDto,
  ProductSummaryDto,
  SellerPaymentAccountDto,
  StoreDetailDto,
  StoreSummaryDto,
  UserDto,
  VerificationStatusDto,
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
    // Solo el sí. `pending` y `rejected` son asunto del dueño de la tienda:
    // publicarlos convertiría la ausencia del tick en una marca negativa.
    isVerified: isVerified(store.verification),
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
    storeIsVerified: isVerified(store.verification),
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

export function toOrderDto(
  order: Order,
  store: Store,
  /** URL de pago vigente, cuando hay un cobro abierto. */
  checkoutUrl: string | null = null,
): OrderDto {
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
    protection: order.protection,
    payment: {
      methodId: order.payment.methodId,
      provider: order.payment.provider,
      label: paymentMethod?.label ?? order.payment.provider,
      status: order.payment.status,
      installments: order.payment.installments,
      reference: order.payment.reference,
      paidAt: order.payment.paidAt?.toISOString() ?? null,
      checkoutUrl,
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

// --- Cobros y confianza (M03) ---------------------------------------------------

export function toPaymentDto(payment: Payment): PaymentDto {
  return {
    id: String(payment.id),
    orderId: payment.orderId ? String(payment.orderId) : null,
    status: payment.status,
    currency: payment.currency,
    // El reparto sale del pago, congelado como se aplicó. Nunca se recalcula
    // al leer: la política puede haber cambiado desde entonces.
    grossMinor: payment.split.grossMinor,
    commissionMinor: payment.split.commissionMinor,
    commissionRateBps: payment.split.commissionRateBps,
    commissionPolicy: payment.split.commissionPolicy,
    netMinor: payment.split.netMinor,
    installments: payment.installments,
    checkoutUrl: payment.checkoutUrl,
    createdAt: payment.createdAt.toISOString(),
    approvedAt: payment.approvedAt?.toISOString() ?? null,
  };
}

export function toSellerPaymentAccountDto(
  account: SellerPaymentAccountView,
): SellerPaymentAccountDto {
  // Los tokens no llegan hasta acá: `toAccountView` ya los dejó afuera en el
  // dominio, y este mapeo solo copia lo que quedó.
  return {
    provider: account.provider,
    status: account.status,
    accountLabel: account.accountLabel,
    connectedAt: account.connectedAt?.toISOString() ?? null,
  };
}

/**
 * El estado de una verificación, **para su dueño**.
 *
 * `rejectionReason` es interno y aun así viaja acá: su destinatario es
 * exactamente quien tiene que corregir el dato. No aparece en ninguna
 * respuesta pública.
 */
export function toVerificationStatusDto(verification: {
  status: VerificationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}): VerificationStatusDto {
  return {
    status: verification.status,
    submittedAt: verification.submittedAt?.toISOString() ?? null,
    reviewedAt: verification.reviewedAt?.toISOString() ?? null,
    rejectionReason: verification.rejectionReason,
  };
}

export function toDisputeDto(dispute: Dispute): DisputeDto {
  return {
    orderId: String(dispute.orderId),
    reason: dispute.reason,
    status: dispute.status,
    detail: dispute.detail,
    openedAt: dispute.openedAt.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  };
}
