import type {
  Follow,
  LiveMessage,
  LiveSession,
  Order,
  OrderItem,
  Product,
  Store,
  StoreCategory,
} from '@vivo/domain';
import { getMarket } from '@vivo/config';
import {
  DEFAULT_STORE_SETTINGS,
  asLiveSessionId,
  asMessageId,
  asOrderId,
  asProductId,
  asStoreId,
  asUserId,
  buildOrderCode,
  buildOrderItem,
  calculateOrderTotals,
} from '@vivo/domain';
import { PRODUCT_BLUEPRINTS, materializeProduct } from './catalog';
import type { DemoDataset, DemoDatasetOptions, DemoUser } from './types';

/** Every demo account shares this password. Development only. */
export const DEMO_PASSWORD = 'vivo1234';

const minutes = (value: number) => value * 60_000;
const hours = (value: number) => value * 3_600_000;
const days = (value: number) => value * 86_400_000;

interface StoreBlueprint {
  readonly key: string;
  readonly name: string;
  readonly ownerKey: string;
  readonly category: StoreCategory;
  readonly description: string;
  readonly city: string;
  readonly rating: number;
  readonly reviews: number;
  readonly sales: number;
  readonly followers: number;
  readonly freeShippingThresholdMinor?: number;
  readonly pickupInstructions?: string;
  /**
   * Si el comercio pasó la verificación comercial.
   *
   * El dataset mezcla tiendas con y sin tick a propósito. Es la única forma de
   * ver en la demo lo que la UI tiene que sostener: que una tienda sin ✓ se ve
   * completa y normal, sin nada que sugiera que hay algo mal con ella.
   */
  readonly verified?: boolean;
}

const STORE_BLUEPRINTS: readonly StoreBlueprint[] = [
  {
    key: 'plaza-moda',
    name: 'Plaza Moda',
    verified: true,
    ownerKey: 'martina',
    category: 'moda',
    description:
      'Ropa de autor producida en Montevideo. Tiradas cortas, telas nobles y talles reales. Transmitimos los martes y jueves.',
    city: 'Montevideo',
    rating: 482,
    reviews: 214,
    sales: 1890,
    followers: 12480,
    freeShippingThresholdMinor: 350000,
    pickupInstructions: 'Retiro en Cordón, de lunes a viernes de 10 a 18 h.',
  },
  {
    key: 'rambla-beauty',
    name: 'Rambla Beauty',
    ownerKey: 'lucia',
    category: 'belleza',
    description:
      'Skincare simple y honesto. Explicamos ingredientes, no promesas. Envíos a todo el país.',
    city: 'Montevideo',
    rating: 491,
    reviews: 402,
    sales: 3120,
    followers: 20340,
    freeShippingThresholdMinor: 250000,
  },
  {
    key: 'taller-ceibo',
    name: 'Taller Ceibo',
    ownerKey: 'diego',
    category: 'hogar',
    description:
      'Objetos de madera y cerámica hechos a mano en Las Piedras. Cada pieza sale distinta y así nos gusta.',
    city: 'Canelones',
    rating: 475,
    reviews: 96,
    sales: 540,
    followers: 4210,
    pickupInstructions: 'Retiro en el taller de Las Piedras, coordinando por mensaje.',
  },
  {
    key: 'bunker-coleccionables',
    name: 'Búnker Coleccionables',
    ownerKey: 'sofia',
    category: 'coleccionables',
    description:
      'Figuras, cartas y maquetas. Mostramos el estado real de cada pieza en vivo antes de venderla.',
    city: 'Maldonado',
    rating: 468,
    reviews: 158,
    sales: 730,
    followers: 8760,
  },
  {
    key: 'cable-sur',
    verified: true,
    name: 'Cable Sur',
    ownerKey: 'rodrigo',
    category: 'tecnologia',
    description:
      'Accesorios probados antes de venderlos. Garantía propia de 6 meses y soporte por WhatsApp.',
    city: 'Salto',
    rating: 456,
    reviews: 311,
    sales: 1420,
    followers: 6190,
    freeShippingThresholdMinor: 400000,
  },
];

interface UserBlueprint {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly seller: boolean;
}

const USER_BLUEPRINTS: readonly UserBlueprint[] = [
  { key: 'ana', name: 'Ana Pérez', email: 'ana@vivo.uy', phone: '+59899123456', seller: false },
  { key: 'martina', name: 'Martina Silva', email: 'martina@vivo.uy', phone: '+59899234567', seller: true },
  { key: 'lucia', name: 'Lucía Ferrari', email: 'lucia@vivo.uy', phone: '+59899345678', seller: true },
  { key: 'diego', name: 'Diego Rivas', email: 'diego@vivo.uy', phone: '+59899456789', seller: true },
  { key: 'sofia', name: 'Sofía Núñez', email: 'sofia@vivo.uy', phone: '+59899567890', seller: true },
  { key: 'rodrigo', name: 'Rodrigo Méndez', email: 'rodrigo@vivo.uy', phone: '+59899678901', seller: true },
  { key: 'camila', name: 'Camila Rossi', email: 'camila@vivo.uy', phone: null, seller: false },
  { key: 'joaquin', name: 'Joaquín Bentancur', email: 'joaquin@vivo.uy', phone: null, seller: false },
  { key: 'valentina', name: 'Valentina Cabrera', email: 'valentina@vivo.uy', phone: null, seller: false },
  { key: 'nicolas', name: 'Nicolás Duarte', email: 'nicolas@vivo.uy', phone: null, seller: false },
  { key: 'paula', name: 'Paula Sosa', email: 'paula@vivo.uy', phone: null, seller: false },
];

interface LiveBlueprint {
  readonly key: string;
  readonly storeKey: string;
  readonly title: string;
  readonly status: LiveSession['status'];
  /** Minutes relative to `now`. Negative is in the past. */
  readonly offsetMinutes: number;
  readonly durationMinutes?: number;
  readonly viewers?: number;
  readonly peak?: number;
  readonly likes?: number;
  readonly productKeys: readonly string[];
  readonly featuredKey?: string;
}

const LIVE_BLUEPRINTS: readonly LiveBlueprint[] = [
  {
    key: 'live-plaza-otono',
    storeKey: 'plaza-moda',
    title: 'Nueva colección otoño — todo con envío gratis',
    status: 'live',
    offsetMinutes: -14,
    viewers: 327,
    peak: 412,
    likes: 2840,
    productKeys: ['campera-roma', 'pantalon-cordon', 'buzo-parque', 'camisa-prado', 'bolso-cordon'],
    featuredKey: 'campera-roma',
  },
  {
    key: 'live-rambla-rutina',
    storeKey: 'rambla-beauty',
    title: 'Armamos tu rutina de piel en 30 minutos',
    status: 'live',
    offsetMinutes: -42,
    viewers: 189,
    peak: 244,
    likes: 1620,
    productKeys: ['serum-rambla', 'protector-costa', 'crema-noche', 'kit-rutina'],
    featuredKey: 'serum-rambla',
  },
  {
    key: 'live-cable-setup',
    storeKey: 'cable-sur',
    title: 'Setup para transmitir desde el celular',
    status: 'scheduled',
    offsetMinutes: 35,
    productKeys: ['aro-luz', 'microfono-solapa', 'soporte-celular', 'cargador-gan'],
  },
  {
    key: 'live-ceibo-taller',
    storeKey: 'taller-ceibo',
    title: 'Desde el taller: piezas nuevas de cerámica',
    status: 'scheduled',
    offsetMinutes: 150,
    productKeys: ['juego-tazas', 'mate-ceibo', 'tabla-quebracho'],
  },
  {
    key: 'live-bunker-subasta',
    storeKey: 'bunker-coleccionables',
    title: 'Abrimos cajas selladas serie Austral',
    status: 'scheduled',
    offsetMinutes: 1_170,
    productKeys: ['carta-holo', 'album-figuritas', 'figura-piloto'],
  },
  {
    key: 'live-plaza-anterior',
    storeKey: 'plaza-moda',
    title: 'Últimos talles de la temporada pasada',
    status: 'ended',
    offsetMinutes: -1_500,
    durationMinutes: 52,
    viewers: 0,
    peak: 356,
    likes: 2110,
    productKeys: ['buzo-parque', 'camisa-prado', 'vestido-solis'],
  },
];

const CHAT_LINES: Record<string, ReadonlyArray<[string, string]>> = {
  'live-plaza-otono': [
    ['camila', '¿Hay talle M en negro?'],
    ['joaquin', '¿Envían al interior?'],
    ['valentina', 'Me encanta el color beige 😍'],
    ['ana', '¿La campera abriga para junio?'],
    ['nicolas', '¿Cuánto sale el envío a Salto?'],
    ['paula', 'Compré el buzo la semana pasada, llegó impecable'],
    ['camila', '¿Se puede retirar en Cordón?'],
    ['valentina', '¿Tienen talles más grandes?'],
    ['joaquin', 'Mostrá el interior del bolso porfa'],
    ['ana', 'Listo, me llevo la campera 🙌'],
  ],
  'live-rambla-rutina': [
    ['paula', '¿El sérum sirve para piel sensible?'],
    ['ana', '¿Se puede usar de día con el protector?'],
    ['nicolas', '¿Cada cuánto se aplica el retinol?'],
    ['camila', 'Ya tengo el kit y anda genial'],
    ['valentina', '¿Vence pronto el frasco abierto?'],
    ['joaquin', '¿Hacen envío a Paysandú?'],
    ['paula', '¿Cuál recomendás para empezar?'],
    ['ana', 'Gracias por explicar los ingredientes 👏'],
  ],
};

function buildUsers(now: Date): DemoUser[] {
  return USER_BLUEPRINTS.map((blueprint, index) => ({
    id: asUserId(blueprint.key),
    name: blueprint.name,
    email: blueprint.email,
    phone: blueprint.phone,
    avatarUrl: `/media/avatar/${blueprint.key}`,
    country: 'UY' as const,
    roles: blueprint.seller ? (['buyer', 'seller'] as const) : (['buyer'] as const),
    status: 'active' as const,
    createdAt: new Date(now.getTime() - days(120 - index * 3)),
    updatedAt: new Date(now.getTime() - days(2)),
    password: DEMO_PASSWORD,
  }));
}

function buildStores(now: Date): Store[] {
  return STORE_BLUEPRINTS.map((blueprint, index) => ({
    id: asStoreId(blueprint.key),
    ownerId: asUserId(blueprint.ownerKey),
    name: blueprint.name,
    slug: blueprint.key,
    description: blueprint.description,
    category: blueprint.category,
    logoUrl: `/media/store/${blueprint.key}`,
    coverUrl: `/media/cover/${blueprint.key}`,
    country: 'UY' as const,
    currency: 'UYU' as const,
    city: blueprint.city,
    reputation: {
      ratingBps: blueprint.rating,
      reviewCount: blueprint.reviews,
      salesCount: blueprint.sales,
    },
    followerCount: blueprint.followers,
    verification: blueprint.verified ? ('verified' as const) : ('unverified' as const),
    status: 'active' as const,
    settings: {
      ...DEFAULT_STORE_SETTINGS,
      freeShippingThresholdMinor: blueprint.freeShippingThresholdMinor ?? null,
      pickupInstructions: blueprint.pickupInstructions ?? null,
    },
    createdAt: new Date(now.getTime() - days(200 - index * 12)),
    updatedAt: new Date(now.getTime() - days(1)),
  }));
}

function buildLiveSessions(now: Date): LiveSession[] {
  return LIVE_BLUEPRINTS.map((blueprint) => {
    const anchor = new Date(now.getTime() + minutes(blueprint.offsetMinutes));
    const started = blueprint.status === 'scheduled' ? null : anchor;
    const ended =
      blueprint.status === 'ended'
        ? new Date(anchor.getTime() + minutes(blueprint.durationMinutes ?? 45))
        : null;

    return {
      id: asLiveSessionId(blueprint.key),
      storeId: asStoreId(blueprint.storeKey),
      title: blueprint.title,
      status: blueprint.status,
      thumbnailUrl: `/media/live/${blueprint.key}`,
      scheduledAt: blueprint.status === 'scheduled' ? anchor : null,
      startedAt: started,
      endedAt: ended,
      viewerCount: blueprint.viewers ?? 0,
      peakViewerCount: blueprint.peak ?? blueprint.viewers ?? 0,
      likeCount: blueprint.likes ?? 0,
      products: blueprint.productKeys.map((key, position) => ({
        productId: asProductId(key),
        position,
        soldCount: blueprint.status === 'ended' ? (position + 1) * 2 : position === 0 ? 4 : 0,
      })),
      featuredProductId: blueprint.featuredKey ? asProductId(blueprint.featuredKey) : null,
      // Seeded sessions have no room: a channel is opened by the provider when
      // a seller actually presses "Transmitir", never by fixture data.
      channel: null,
      interruptedAt: null,
      createdAt: new Date(anchor.getTime() - hours(20)),
      updatedAt: now,
    };
  });
}

function buildMessages(now: Date): LiveMessage[] {
  const users = new Map(USER_BLUEPRINTS.map((user) => [user.key, user]));
  const messages: LiveMessage[] = [];

  for (const [liveKey, lines] of Object.entries(CHAT_LINES)) {
    lines.forEach(([userKey, body], index) => {
      const author = users.get(userKey);
      messages.push({
        id: asMessageId(`${liveKey}-m${index + 1}`),
        liveSessionId: asLiveSessionId(liveKey),
        authorId: asUserId(userKey),
        authorName: author?.name ?? 'Alguien',
        authorAvatarUrl: `/media/avatar/${userKey}`,
        kind: 'chat',
        body,
        createdAt: new Date(now.getTime() - minutes((lines.length - index) * 1.5)),
      });
    });
  }

  return messages;
}

function buildFollows(now: Date): Follow[] {
  const pairs: Array<[string, string]> = [
    ['ana', 'plaza-moda'],
    ['ana', 'rambla-beauty'],
    ['ana', 'taller-ceibo'],
    ['camila', 'plaza-moda'],
    ['joaquin', 'cable-sur'],
    ['valentina', 'rambla-beauty'],
    ['paula', 'bunker-coleccionables'],
  ];

  return pairs.map(([userKey, storeKey], index) => ({
    userId: asUserId(userKey),
    storeId: asStoreId(storeKey),
    notifyOnLive: true,
    createdAt: new Date(now.getTime() - days(30 - index)),
  }));
}

/**
 * Demo lines go through the same `buildOrderItem` the real checkout uses, so
 * the seeded orders carry genuine tax snapshots rather than a second, subtly
 * different implementation of the same arithmetic.
 */
function orderItemFrom(product: Product, variantIndex: number, quantity: number): OrderItem {
  const variant = product.variants[variantIndex] ?? product.variants[0];
  if (!variant) throw new Error(`Product ${product.id} has no variants`);
  return buildOrderItem(product, variant, quantity, getMarket('UY').tax);
}

function buildOrders(now: Date, products: readonly Product[]): Order[] {
  const byKey = new Map(products.map((product) => [String(product.id), product]));
  const anaAddress = {
    id: null,
    recipientName: 'Ana Pérez',
    phone: '+59899123456',
    country: 'UY' as const,
    regionCode: 'MO',
    regionName: 'Montevideo',
    locality: 'Pocitos',
    street: 'Av. Brasil 2550, apto 401',
    postalCode: '11300',
    notes: 'Portero eléctrico 401',
  };

  interface OrderPlan {
    readonly key: string;
    readonly storeKey: string;
    readonly lines: ReadonlyArray<[string, number, number]>;
    readonly status: Order['status'];
    readonly daysAgo: number;
    readonly deliveryKind: 'shipping' | 'pickup' | 'seller_coordination';
    readonly liveKey?: string;
  }

  const plans: readonly OrderPlan[] = [
    {
      key: 'order-ana-1',
      storeKey: 'plaza-moda',
      lines: [['buzo-parque', 0, 1]],
      status: 'delivered',
      daysAgo: 21,
      deliveryKind: 'shipping',
      liveKey: 'live-plaza-anterior',
    },
    {
      key: 'order-ana-2',
      storeKey: 'rambla-beauty',
      lines: [
        ['serum-rambla', 0, 1],
        ['protector-costa', 0, 1],
      ],
      status: 'shipped',
      daysAgo: 4,
      deliveryKind: 'shipping',
    },
    {
      key: 'order-ana-3',
      storeKey: 'taller-ceibo',
      lines: [['mate-ceibo', 0, 1]],
      status: 'preparing',
      daysAgo: 2,
      deliveryKind: 'pickup',
    },
    {
      key: 'order-ana-4',
      storeKey: 'bunker-coleccionables',
      lines: [['album-figuritas', 0, 2]],
      status: 'pending_payment',
      daysAgo: 0,
      deliveryKind: 'seller_coordination',
    },
  ];

  const deliveryLabels = {
    shipping: { label: 'Envío a domicilio', estimate: '2 a 4 días hábiles', methodId: 'uy-home-delivery', fee: 19000 },
    pickup: { label: 'Retiro en la tienda', estimate: 'Disponible en 24 h', methodId: 'uy-pickup', fee: 0 },
    seller_coordination: {
      label: 'Coordinar con el vendedor',
      estimate: 'A coordinar',
      methodId: 'uy-seller-coordination',
      fee: 0,
    },
  } as const;

  const statusFlow: Record<Order['status'], readonly Order['status'][]> = {
    pending_payment: ['pending_payment'],
    paid: ['pending_payment', 'paid'],
    preparing: ['pending_payment', 'paid', 'preparing'],
    shipped: ['pending_payment', 'paid', 'preparing', 'shipped'],
    delivered: ['pending_payment', 'paid', 'preparing', 'shipped', 'delivered'],
    completed: ['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed'],
    cancelled: ['pending_payment', 'cancelled'],
  };

  return plans.map((plan) => {
    const createdAt = new Date(now.getTime() - days(plan.daysAgo) - hours(3));
    const items = plan.lines.map(([productKey, variantIndex, quantity]) => {
      const product = byKey.get(productKey);
      if (!product) throw new Error(`Unknown product in seed order: ${productKey}`);
      return orderItemFrom(product, variantIndex, quantity);
    });

    const delivery = deliveryLabels[plan.deliveryKind];
    const totals = calculateOrderTotals({
      items,
      currency: 'UYU',
      shippingMinor: delivery.fee,
      tax: getMarket('UY').tax,
    });
    const paid = plan.status !== 'pending_payment' && plan.status !== 'cancelled';

    const stages = statusFlow[plan.status];
    const timeline = stages.map((status, index) => ({
      status,
      at: new Date(createdAt.getTime() + hours(index * 8)),
      note: null,
    }));

    return {
      id: asOrderId(plan.key),
      code: buildOrderCode(plan.key),
      buyerId: asUserId('ana'),
      storeId: asStoreId(plan.storeKey),
      liveSessionId: plan.liveKey ? asLiveSessionId(plan.liveKey) : null,
      items,
      currency: 'UYU' as const,
      subtotalMinor: totals.subtotalMinor,
      shippingMinor: totals.shippingMinor,
      discountMinor: totals.discountMinor,
      totalMinor: totals.totalMinor,
      taxMinor: totals.taxMinor,
      tax: totals.tax,
      status: plan.status,
      // El proveedor simulado del dataset no retiene fondos, así que ningún
      // pedido de demo puede decir que está protegido. Ver `protection.ts`.
      protection: 'not_applicable' as const,
      payment: {
        methodId: 'uy-mercadopago',
        provider: 'mercadopago',
        status: paid ? ('approved' as const) : ('pending' as const),
        installments: 1,
        reference: paid ? `demo-${plan.key}` : null,
        paidAt: paid ? new Date(createdAt.getTime() + minutes(6)) : null,
      },
      delivery: {
        methodId: delivery.methodId,
        kind: plan.deliveryKind,
        label: delivery.label,
        estimate: delivery.estimate,
        address: plan.deliveryKind === 'shipping' ? anaAddress : null,
        trackingCode: plan.status === 'shipped' || plan.status === 'delivered' ? 'UY-482-119-03' : null,
      },
      buyerNote: null,
      timeline,
      createdAt,
      updatedAt: timeline[timeline.length - 1]?.at ?? createdAt,
    };
  });
}

/**
 * Builds the whole demo world. Deterministic given `now`, which lets the API
 * seed Postgres and the in-memory driver boot from the exact same data.
 */
export function buildDemoDataset(options: DemoDatasetOptions = {}): DemoDataset {
  const now = options.now ?? new Date();
  const products = PRODUCT_BLUEPRINTS.map((blueprint) =>
    materializeProduct(blueprint, new Date(now.getTime() - days(30))),
  );

  return {
    users: buildUsers(now),
    stores: buildStores(now),
    products,
    liveSessions: buildLiveSessions(now),
    liveMessages: buildMessages(now),
    follows: buildFollows(now),
    orders: buildOrders(now, products),
  };
}
