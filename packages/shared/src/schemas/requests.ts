import { PRODUCT_STATUSES, STORE_CATEGORIES, ORDER_STATUSES } from '@vivo/domain';
import { z } from 'zod';
import { addressSchema } from './entities';
import {
  countrySchema,
  emailSchema,
  idSchema,
  isoDateSchema,
  minorAmountSchema,
  passwordSchema,
  phoneSchema,
  quantitySchema,
  slugSchema,
} from './primitives';

// --- Auth ---------------------------------------------------------------------

export const registerRequestSchema = z.object({
  name: z.string().trim().min(2, 'Ingresá tu nombre').max(80),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  country: countrySchema.default('UY'),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Ingresá tu contraseña'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: phoneSchema.nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

// --- Seller onboarding ---------------------------------------------------------

export const createStoreRequestSchema = z.object({
  name: z.string().trim().min(3, 'El nombre es muy corto').max(60),
  slug: slugSchema.optional(),
  description: z.string().trim().max(400).default(''),
  category: z.enum(STORE_CATEGORIES).default('otros'),
  city: z.string().trim().max(60).optional(),
  country: countrySchema.default('UY'),
});
export type CreateStoreRequest = z.infer<typeof createStoreRequestSchema>;

export const updateStoreRequestSchema = z.object({
  name: z.string().trim().min(3).max(60).optional(),
  description: z.string().trim().max(400).optional(),
  category: z.enum(STORE_CATEGORIES).optional(),
  city: z.string().trim().max(60).nullable().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  coverUrl: z.string().max(500).nullable().optional(),
  deliveryMethodIds: z.array(z.string()).min(1).optional(),
  freeShippingThresholdMinor: minorAmountSchema.nullable().optional(),
  pickupInstructions: z.string().max(240).nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
});
export type UpdateStoreRequest = z.infer<typeof updateStoreRequestSchema>;

// --- Catalog --------------------------------------------------------------------

const variantInputSchema = z.object({
  id: idSchema.optional(),
  optionValues: z.record(z.string(), z.string()).default({}),
  sku: z.string().trim().max(40).nullable().default(null),
  priceMinor: minorAmountSchema.nullable().default(null),
  stock: z.number().int().min(0).max(99_999).default(0),
  active: z.boolean().default(true),
});

export const createProductRequestSchema = z.object({
  title: z.string().trim().min(3, 'El título es muy corto').max(120),
  description: z.string().trim().max(2000).default(''),
  basePriceMinor: minorAmountSchema.refine((value) => value > 0, 'Ingresá un precio'),
  compareAtPriceMinor: minorAmountSchema.nullable().default(null),
  images: z
    .array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(160).default('') }))
    .max(8)
    .default([]),
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(24),
        values: z.array(z.string().trim().min(1).max(24)).min(1).max(12),
      }),
    )
    .max(3)
    .default([]),
  variants: z.array(variantInputSchema).min(1, 'Definí al menos una variante'),
  status: z.enum(PRODUCT_STATUSES).default('active'),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = createProductRequestSchema.partial();
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

// --- Live -----------------------------------------------------------------------

export const createLiveRequestSchema = z
  .object({
    title: z.string().trim().min(3, 'Poné un título').max(90),
    thumbnailUrl: z.string().max(500).nullable().default(null),
    productIds: z.array(idSchema).min(1, 'Elegí al menos un producto').max(30),
    /** `now` starts immediately; `scheduled` requires scheduledAt. */
    mode: z.enum(['now', 'scheduled']).default('now'),
    scheduledAt: isoDateSchema.nullable().default(null),
  })
  .refine((value) => value.mode === 'now' || Boolean(value.scheduledAt), {
    message: 'Elegí fecha y hora',
    path: ['scheduledAt'],
  });
export type CreateLiveRequest = z.infer<typeof createLiveRequestSchema>;

export const featureProductRequestSchema = z.object({
  productId: idSchema.nullable(),
});
export type FeatureProductRequest = z.infer<typeof featureProductRequestSchema>;

export const postMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(240),
});
export type PostMessageRequest = z.infer<typeof postMessageRequestSchema>;

export const reactRequestSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
});
export type ReactRequest = z.infer<typeof reactRequestSchema>;

// --- Checkout ---------------------------------------------------------------------

export const checkoutLineSchema = z.object({
  productId: idSchema,
  variantId: idSchema,
  quantity: quantitySchema,
});

export const checkoutPreviewRequestSchema = z.object({
  lines: z.array(checkoutLineSchema).min(1).max(20),
  deliveryMethodId: z.string().min(1),
  installments: z.number().int().min(1).max(24).default(1),
});
export type CheckoutPreviewRequest = z.infer<typeof checkoutPreviewRequestSchema>;

export const createOrderRequestSchema = z.object({
  lines: z.array(checkoutLineSchema).min(1).max(20),
  deliveryMethodId: z.string().min(1, 'Elegí cómo recibir el pedido'),
  paymentMethodId: z.string().min(1, 'Elegí un medio de pago'),
  installments: z.number().int().min(1).max(24).default(1),
  address: addressSchema.nullable().default(null),
  buyerNote: z.string().trim().max(240).nullable().default(null),
  liveSessionId: idSchema.nullable().default(null),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/**
 * Idempotency key format, shared by the client that generates it and the
 * server that validates it. Kept here so the two can never disagree.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_:.-]{8,128}$/, 'Referencia de pedido inválida');

/**
 * M01 settles payments with a simulated provider. The shape already matches
 * what a real PaymentProvider callback will carry, so wiring Mercado Pago is a
 * provider swap rather than an API change.
 */
export const confirmPaymentRequestSchema = z.object({
  outcome: z.enum(['approved', 'rejected']).default('approved'),
});
export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>;

export const updateOrderStatusRequestSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(240).nullable().default(null),
});
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusRequestSchema>;

// --- Analytics -----------------------------------------------------------------

export const analyticsEventRequestSchema = z.object({
  name: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).default({}),
  occurredAt: isoDateSchema.optional(),
});
export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;
