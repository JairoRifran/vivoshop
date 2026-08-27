import {
  DISPUTE_REASONS,
  MAX_BID_MINOR,
  ORDER_STATUSES,
  PRODUCT_STATUSES,
  STORE_CATEGORIES,
} from '@vivo/domain';
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

/**
 * La imagen se manda por **clave**, no por URL.
 *
 * Antes esto aceptaba `avatarUrl: string`, y eso significaba que cualquiera
 * podía poner ahí la URL que quisiera: la foto de otra persona, un pixel de
 * rastreo alojado en su servidor, o una imagen que cambiara de contenido
 * después de que la moderemos. Una clave solo puede referirse a algo que se
 * subió a nuestro almacenamiento, y el servidor comprueba además que el
 * segmento del dueño sea quien está en sesión. Ver `assertOwnMediaKey`.
 *
 * `null` borra la imagen; omitir el campo la deja como está.
 */
export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: phoneSchema.nullable().optional(),
  avatarKey: z.string().max(300).nullable().optional(),
  bio: z.string().trim().max(280).nullable().optional(),
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
  /** Claves de nuestro almacenamiento, no URLs. Ver `updateProfileRequestSchema`. */
  logoKey: z.string().max(300).nullable().optional(),
  coverKey: z.string().max(300).nullable().optional(),
  whatsapp: z.string().trim().max(30).nullable().optional(),
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
  /**
   * La oferta aceptada que fija el precio de esta línea.
   *
   * Viaja el **id**, nunca el monto. Si el monto viniera del navegador,
   * cualquiera compraría al precio que escribiera; el servidor lee la oferta,
   * verifica que sea la aceptada, que sea de quien está comprando y que la
   * reserva siga viva, y recién ahí usa su importe.
   */
  bidId: idSchema.optional(),
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
 * Desenlace de un cobro **simulado**.
 *
 * Solo lo acepta el entorno de desarrollo, y solo el proveedor `fake`. Con un
 * proveedor real quien decide es el webhook: si esto siguiera abierto sería un
 * botón público para marcar pedidos como pagos.
 */
export const simulatePaymentRequestSchema = z.object({
  outcome: z.enum(['approved', 'rejected']).default('approved'),
});
export type SimulatePaymentRequest = z.infer<typeof simulatePaymentRequestSchema>;

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

// --- Cobros y confianza (M03) ---------------------------------------------------

/**
 * Datos del **negocio**, para el ✓ Tienda Verificada.
 *
 * El identificador tributario es obligatorio acá y en ningún otro lado del
 * producto: es lo que separa un comercio formal de una persona que vende, y
 * sin él el tick estaría afirmando algo que nadie comprobó. Pedirlo para
 * verificarse no lo vuelve necesario para vender — vender no pasa por este
 * formulario.
 */
export const businessVerificationRequestSchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  taxId: z.string().trim().min(6).max(24),
  responsibleName: z.string().trim().min(2).max(120),
  responsibleDocument: z.string().trim().min(4).max(32),
  commercialAddress: z.string().trim().min(6).max(200),
  contactPhone: z.string().trim().min(6).max(24),
  contactEmail: z.string().trim().email().max(160),
});
export type BusinessVerificationRequest = z.infer<typeof businessVerificationRequestSchema>;

/**
 * Identidad de una persona. No otorga tick y no pide nada del negocio: un
 * vendedor particular puede verificar quién es sin tener RUT.
 */
export const identityVerificationRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  documentNumber: z.string().trim().min(4).max(32),
  documentType: z.string().trim().min(2).max(24),
  phone: z.string().trim().min(6).max(24),
  email: z.string().trim().email().max(160),
});
export type IdentityVerificationRequest = z.infer<typeof identityVerificationRequestSchema>;

export const openDisputeRequestSchema = z.object({
  reason: z.enum(DISPUTE_REASONS),
  detail: z.string().trim().max(600).default(''),
});
export type OpenDisputeRequest = z.infer<typeof openDisputeRequestSchema>;

// --- Modo Puja (M04) ------------------------------------------------------------

/**
 * Abrir una puja.
 *
 * El precio de referencia **no** viene acá: lo congela el servidor desde el
 * catálogo. Dejar que el navegador proponga cuánto "vale" el producto sería
 * dejarlo inventar el número que después se le muestra a cada persona que
 * oferta.
 */
export const openBidSessionRequestSchema = z.object({
  liveSessionId: idSchema,
  productId: idSchema,
  /** Sin esto se usa la primera variante con stock. */
  variantId: idSchema.optional(),
  minimumBidMinor: minorAmountSchema.max(MAX_BID_MINOR).nullable().default(null),
  minimumIncrementMinor: minorAmountSchema.max(MAX_BID_MINOR).nullable().default(null),
});
export type OpenBidSessionRequest = z.infer<typeof openBidSessionRequestSchema>;

/**
 * Una oferta. Un entero positivo y nada más.
 *
 * El tope se valida acá **y** en el dominio: acá para devolver un 400 legible,
 * y allá porque la regla no puede depender de que alguien haya pasado por esta
 * ruta.
 */
export const submitBidRequestSchema = z.object({
  amountMinor: z.number().int().positive().max(MAX_BID_MINOR),
});
export type SubmitBidRequest = z.infer<typeof submitBidRequestSchema>;

export const acceptBidRequestSchema = z.object({
  bidId: idSchema,
});
export type AcceptBidRequest = z.infer<typeof acceptBidRequestSchema>;
