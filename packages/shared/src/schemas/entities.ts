import {
  DISPUTE_REASONS,
  DISPUTE_STATUSES,
  LIVE_STATUSES,
  MESSAGE_KINDS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  PROTECTION_LEVELS,
  PROTECTION_STATUSES,
  SELLER_ACCOUNT_STATUSES,
  STORE_CATEGORIES,
  STORE_STATUSES,
  USER_ROLES,
  VERIFICATION_STATUSES,
} from '@vivo/domain';
import { z } from 'zod';
import {
  countrySchema,
  currencySchema,
  idSchema,
  isoDateSchema,
  minorAmountSchema,
  slugSchema,
} from './primitives';

// --- User --------------------------------------------------------------------

export const userSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  country: countrySchema,
  roles: z.array(z.enum(USER_ROLES)),
  createdAt: isoDateSchema,
});
export type UserDto = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  token: z.string(),
  expiresAt: isoDateSchema,
  user: userSchema,
});
export type SessionDto = z.infer<typeof sessionSchema>;

// --- Store -------------------------------------------------------------------

export const storeSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
  category: z.enum(STORE_CATEGORIES),
  logoUrl: z.string().nullable(),
  coverUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: countrySchema,
  currency: currencySchema,
  rating: z.number(),
  reviewCount: z.number().int(),
  followerCount: z.number().int(),
  status: z.enum(STORE_STATUSES),
  /**
   * Si la tienda tiene el ✓ comercial.
   *
   * Un booleano y no el estado completo: que una verificación esté `pending` o
   * `rejected` es asunto de su dueño, y publicarlo convertiría la ausencia del
   * tick en una marca. Afuera solo existe "verificada" o nada.
   */
  isVerified: z.boolean(),
  /** Present only when the request is authenticated. */
  isFollowing: z.boolean().optional(),
  isLiveNow: z.boolean().optional(),
});
export type StoreSummaryDto = z.infer<typeof storeSummarySchema>;

export const storeDetailSchema = storeSummarySchema.extend({
  description: z.string(),
  ownerId: idSchema,
  salesCount: z.number().int(),
  deliveryMethodIds: z.array(z.string()),
  freeShippingThresholdMinor: minorAmountSchema.nullable(),
  pickupInstructions: z.string().nullable(),
  acceptsReturns: z.boolean(),
  createdAt: isoDateSchema,
});
export type StoreDetailDto = z.infer<typeof storeDetailSchema>;

// --- Catalog -----------------------------------------------------------------

export const productImageSchema = z.object({ url: z.string(), alt: z.string() });

export const productOptionSchema = z.object({
  name: z.string(),
  values: z.array(z.string()),
});

export const productVariantSchema = z.object({
  id: idSchema,
  optionValues: z.record(z.string(), z.string()),
  label: z.string(),
  sku: z.string().nullable(),
  priceMinor: minorAmountSchema,
  stock: z.number().int().min(0),
  active: z.boolean(),
});
export type ProductVariantDto = z.infer<typeof productVariantSchema>;

export const productSummarySchema = z.object({
  id: idSchema,
  storeId: idSchema,
  storeName: z.string(),
  storeSlug: slugSchema,
  /**
   * Si la tienda que lo vende tiene el ✓.
   *
   * Denormalizado en la ficha para que una grilla de productos no tenga que
   * pedir la tienda de cada uno solo para dibujar un adorno.
   */
  storeIsVerified: z.boolean(),
  title: z.string(),
  priceMinor: minorAmountSchema,
  compareAtPriceMinor: minorAmountSchema.nullable(),
  discountPercent: z.number().int().nullable(),
  currency: currencySchema,
  image: productImageSchema.nullable(),
  stock: z.number().int().min(0),
  status: z.enum(PRODUCT_STATUSES),
});
export type ProductSummaryDto = z.infer<typeof productSummarySchema>;

export const productDetailSchema = productSummarySchema.extend({
  description: z.string(),
  images: z.array(productImageSchema),
  options: z.array(productOptionSchema),
  variants: z.array(productVariantSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ProductDetailDto = z.infer<typeof productDetailSchema>;

// --- Live --------------------------------------------------------------------

export const liveSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  status: z.enum(LIVE_STATUSES),
  thumbnailUrl: z.string().nullable(),
  scheduledAt: isoDateSchema.nullable(),
  startedAt: isoDateSchema.nullable(),
  endedAt: isoDateSchema.nullable(),
  viewerCount: z.number().int(),
  likeCount: z.number().int(),
  productCount: z.number().int(),
  store: storeSummarySchema,
  featuredProduct: productSummarySchema.nullable(),
});
export type LiveSummaryDto = z.infer<typeof liveSummarySchema>;

/**
 * What the client may know about the video room.
 *
 * Provider and channel id only. The join token is never part of a detail
 * payload: it is short-lived, per participant, and minted by its own endpoint
 * after a server-side authorisation check.
 */
export const liveChannelSchema = z.object({
  provider: z.string(),
  channelId: z.string(),
});
export type LiveChannelDto = z.infer<typeof liveChannelSchema>;

export const liveDetailSchema = liveSummarySchema.extend({
  peakViewerCount: z.number().int(),
  channel: liveChannelSchema.nullable(),
  products: z.array(productSummarySchema),
  featuredProductId: idSchema.nullable(),
});
export type LiveDetailDto = z.infer<typeof liveDetailSchema>;

/**
 * A join credential for one participant.
 *
 * `canPublish` is informational for the UI; the real restriction is baked into
 * the token by the server and enforced by the provider.
 */
export const streamCredentialsSchema = z.object({
  url: z.string(),
  token: z.string(),
  identity: z.string(),
  expiresAt: isoDateSchema,
  canPublish: z.boolean(),
});
export type StreamCredentialsDto = z.infer<typeof streamCredentialsSchema>;

/** Null when the session has no video yet, or is already over. */
export const viewerTokenResponseSchema = z.object({
  credentials: streamCredentialsSchema.nullable(),
});
export type ViewerTokenResponseDto = z.infer<typeof viewerTokenResponseSchema>;

export const liveMessageSchema = z.object({
  id: idSchema,
  liveSessionId: idSchema,
  authorId: idSchema.nullable(),
  authorName: z.string(),
  authorAvatarUrl: z.string().nullable(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string(),
  createdAt: isoDateSchema,
});
export type LiveMessageDto = z.infer<typeof liveMessageSchema>;

export const liveStatsSchema = z.object({
  liveSessionId: idSchema,
  viewerCount: z.number().int(),
  likeCount: z.number().int(),
  ordersCount: z.number().int(),
  unitsSold: z.number().int(),
  revenueMinor: minorAmountSchema,
  currency: currencySchema,
  elapsedSeconds: z.number().int(),
});
export type LiveStatsDto = z.infer<typeof liveStatsSchema>;

// --- Orders ------------------------------------------------------------------

export const addressSchema = z.object({
  id: idSchema.nullable(),
  recipientName: z.string().min(2).max(80),
  phone: z.string().min(6).max(24),
  country: countrySchema,
  regionCode: z.string().min(1).max(8),
  regionName: z.string().min(1).max(64),
  locality: z.string().min(2).max(80),
  street: z.string().min(4).max(160),
  postalCode: z.string().max(16).nullable(),
  notes: z.string().max(240).nullable(),
});
export type AddressDto = z.infer<typeof addressSchema>;

/** Snapshot of the tax rule an order or a line was charged under. */
export const taxSnapshotSchema = z.object({
  treatment: z.enum(['included', 'added', 'exempt']),
  rateBps: z.number().int(),
  amountMinor: minorAmountSchema,
  label: z.string(),
  category: z.string(),
});
export type TaxSnapshotDto = z.infer<typeof taxSnapshotSchema>;

export const orderItemSchema = z.object({
  productId: idSchema,
  variantId: idSchema,
  title: z.string(),
  variantLabel: z.string(),
  imageUrl: z.string().nullable(),
  unitPriceMinor: minorAmountSchema,
  quantity: z.number().int(),
  subtotalMinor: minorAmountSchema,
  taxCategory: z.string(),
  taxRateBps: z.number().int(),
  taxAmountMinor: minorAmountSchema,
});

export const orderEventSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  at: isoDateSchema,
  note: z.string().nullable(),
});

export const orderSchema = z.object({
  id: idSchema,
  code: z.string(),
  buyerId: idSchema,
  store: storeSummarySchema,
  liveSessionId: idSchema.nullable(),
  items: z.array(orderItemSchema),
  currency: currencySchema,
  subtotalMinor: minorAmountSchema,
  shippingMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  taxMinor: minorAmountSchema,
  tax: taxSnapshotSchema,
  totalMinor: minorAmountSchema,
  status: z.enum(ORDER_STATUSES),
  /** Eje de Compra Protegida, independiente de `status`. */
  protection: z.enum(PROTECTION_STATUSES),
  payment: z.object({
    methodId: z.string(),
    provider: z.string(),
    label: z.string(),
    status: z.enum(PAYMENT_STATUSES),
    installments: z.number().int(),
    reference: z.string().nullable(),
    paidAt: isoDateSchema.nullable(),
    /**
     * A dónde mandar al comprador para pagar, mientras el cobro siga abierto.
     *
     * Se emite y se olvida: no es un permiso ni un secreto, es una URL del
     * proveedor que caduca sola. Ningún token del vendedor viaja acá.
     */
    checkoutUrl: z.string().nullable(),
  }),
  delivery: z.object({
    methodId: z.string(),
    kind: z.enum(['shipping', 'pickup', 'seller_coordination']),
    label: z.string(),
    estimate: z.string(),
    address: addressSchema.nullable(),
    trackingCode: z.string().nullable(),
  }),
  buyerNote: z.string().nullable(),
  timeline: z.array(orderEventSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type OrderDto = z.infer<typeof orderSchema>;

// --- Seller dashboard ---------------------------------------------------------

export const sellerMetricsSchema = z.object({
  storeId: idSchema,
  currency: currencySchema,
  salesTodayMinor: minorAmountSchema,
  ordersToday: z.number().int(),
  ordersPending: z.number().int(),
  viewersLast7Days: z.number().int(),
  /** Basis points: 340 renders as 3,4 %. */
  conversionBps: z.number().int(),
  productsActive: z.number().int(),
  nextLive: liveSummarySchema.nullable(),
  activeLive: liveSummarySchema.nullable(),
});
export type SellerMetricsDto = z.infer<typeof sellerMetricsSchema>;

export const checkoutPreviewSchema = z.object({
  store: storeSummarySchema,
  items: z.array(orderItemSchema),
  currency: currencySchema,
  subtotalMinor: minorAmountSchema,
  shippingMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  taxMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  taxLabel: z.string(),
  tax: taxSnapshotSchema,
  installmentPreview: z
    .object({ installments: z.number().int(), amountMinor: minorAmountSchema })
    .nullable(),
});
export type CheckoutPreviewDto = z.infer<typeof checkoutPreviewSchema>;

// --- Cobros y confianza (M03) --------------------------------------------------

/**
 * Lo que la plataforma puede prometerle al comprador **hoy**, derivado de lo
 * que el proveedor de pagos soporta de verdad.
 *
 * Viaja al navegador para que la UI no tenga que adivinar ni hardcodear una
 * promesa: si el proveedor no retiene el dinero, `level` no es `full` y la
 * pantalla no dice que lo retiene.
 */
export const paymentCapabilitiesSchema = z.object({
  provider: z.string(),
  level: z.enum(PROTECTION_LEVELS),
  supportsRefunds: z.boolean(),
  supportsDisputes: z.boolean(),
  /** Solo con esto en true se puede mostrar "retenido hasta la entrega". */
  supportsDelayedSettlement: z.boolean(),
});
export type PaymentCapabilitiesDto = z.infer<typeof paymentCapabilitiesSchema>;

/**
 * La cuenta de cobro de una tienda, vista desde afuera.
 *
 * Sin tokens, sin id interno del proveedor: solo si está conectada y a nombre
 * de qué. Es un tipo aparte y no un `Omit<>` para que agregar un campo secreto
 * a la entidad no lo filtre acá por descuido.
 */
export const sellerPaymentAccountSchema = z.object({
  provider: z.string(),
  status: z.enum(SELLER_ACCOUNT_STATUSES),
  accountLabel: z.string().nullable(),
  connectedAt: isoDateSchema.nullable(),
});
export type SellerPaymentAccountDto = z.infer<typeof sellerPaymentAccountSchema>;

/** El reparto de un cobro, para que el vendedor vea por qué cobró lo que cobró. */
export const paymentSchema = z.object({
  id: idSchema,
  orderId: idSchema.nullable(),
  status: z.enum(PAYMENT_STATUSES),
  currency: currencySchema,
  grossMinor: minorAmountSchema,
  commissionMinor: minorAmountSchema,
  commissionRateBps: z.number().int(),
  commissionPolicy: z.string(),
  netMinor: minorAmountSchema,
  installments: z.number().int(),
  checkoutUrl: z.string().nullable(),
  createdAt: isoDateSchema,
  approvedAt: isoDateSchema.nullable(),
});
export type PaymentDto = z.infer<typeof paymentSchema>;

/**
 * El estado de la verificación **para su dueño**.
 *
 * Es la única superficie donde `pending` y `rejected` son visibles, y solo
 * para quien pidió la verificación. `rejectionReason` es interno; acá viaja
 * porque su destinatario es exactamente quien tiene que corregir el dato.
 */
export const verificationStatusSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  submittedAt: isoDateSchema.nullable(),
  reviewedAt: isoDateSchema.nullable(),
  rejectionReason: z.string().nullable(),
});
export type VerificationStatusDto = z.infer<typeof verificationStatusSchema>;

export const disputeSchema = z.object({
  orderId: idSchema,
  reason: z.enum(DISPUTE_REASONS),
  status: z.enum(DISPUTE_STATUSES),
  detail: z.string(),
  openedAt: isoDateSchema,
  resolvedAt: isoDateSchema.nullable(),
});
export type DisputeDto = z.infer<typeof disputeSchema>;
