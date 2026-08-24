import type { LiveSessionId, OrderId, ProductId, StoreId, UserId } from '../value-objects/identifiers';
import type { LiveStatus } from './live';

/**
 * The realtime event catalogue.
 *
 * Two kinds of thing travel over the socket, and conflating them is how these
 * systems rot:
 *
 *  - **Ephemeral** events describe what is happening right now. Presence
 *    counts and hearts are the examples. They are never written to Postgres;
 *    losing one costs nothing, and storing every heart of a live with three
 *    thousand viewers would be a self-inflicted wound.
 *  - **Durable** events are the realtime echo of something the API already
 *    committed. A chat message, a change of featured product, a state change,
 *    a sale. The socket is a notification channel for them, never the source
 *    of truth — a client that missed one can refetch and be correct.
 *
 * Nothing in this file imports a transport. It is the shared vocabulary that
 * the gateway, the services and the browser all speak.
 */

export const REALTIME_EVENTS = {
  liveState: 'live.state',
  viewerCount: 'viewer.count',
  chatMessage: 'chat.message',
  reactionBurst: 'reaction.burst',
  productFeatured: 'product.featured',
  orderCreated: 'order.created',
  paymentApproved: 'payment.approved',
  saleAnnounced: 'sale.announced',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Events a client may send. Everything else is server to client. */
export const REALTIME_COMMANDS = {
  join: 'live.join',
  leave: 'live.leave',
  sendChat: 'chat.send',
  sendReaction: 'reaction.send',
} as const;

export type RealtimeCommandName = (typeof REALTIME_COMMANDS)[keyof typeof REALTIME_COMMANDS];

/** Durable: mirrors the persisted session status. */
export interface LiveStatePayload {
  readonly liveSessionId: string;
  readonly status: LiveStatus;
  readonly featuredProductId: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

/** Ephemeral: presence. Never persisted per connection. */
export interface ViewerCountPayload {
  readonly liveSessionId: string;
  readonly viewerCount: number;
}

/** Durable: the message was written before it was broadcast. */
export interface ChatMessagePayload {
  readonly liveSessionId: string;
  readonly id: string;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
}

/** Ephemeral: a burst of hearts, aggregated. */
export interface ReactionBurstPayload {
  readonly liveSessionId: string;
  readonly count: number;
  readonly totalLikes: number;
}

/** Durable: the API validated ownership and persisted the change. */
export interface ProductFeaturedPayload {
  readonly liveSessionId: string;
  readonly productId: string | null;
}

/**
 * Durable, and **private to the seller**. Carries what the broadcast console
 * needs to update its counters, and nothing that identifies the buyer.
 */
export interface OrderCreatedPayload {
  readonly liveSessionId: string;
  readonly orderId: string;
  readonly unitsSold: number;
  readonly ordersCount: number;
  readonly revenueMinor: number;
  readonly currency: string;
  readonly productTitles: readonly string[];
}

/**
 * Durable y **privado del vendedor**: el pago se aprobó de verdad.
 *
 * Separado de `order.created` porque son dos hechos distintos y confundirlos
 * es exactamente lo que este milestone viene a arreglar. Un pedido creado es
 * alguien que apretó "comprar"; un pago aprobado es plata que existe. La
 * consola del vendedor canta "Venta confirmada" solo con esto.
 */
export interface PaymentApprovedPayload {
  /** Null cuando la compra no salió de un vivo. */
  readonly liveSessionId: string | null;
  readonly orderId: string;
  readonly orderCode: string;
  readonly currency: string;
  /** Lo que pagó el comprador. */
  readonly grossMinor: number;
  /** Lo que le queda al vendedor después de la comisión de VivoShop. */
  readonly netMinor: number;
  readonly productTitles: readonly string[];
}

/**
 * Ephemeral and public: the social nudge everyone sees. Deliberately carries
 * no buyer, no order id and no amount — only that a product moved.
 */
export interface SaleAnnouncedPayload {
  readonly liveSessionId: string;
  readonly productTitle: string;
}

export interface RealtimeEventMap {
  'live.state': LiveStatePayload;
  'viewer.count': ViewerCountPayload;
  'chat.message': ChatMessagePayload;
  'reaction.burst': ReactionBurstPayload;
  'product.featured': ProductFeaturedPayload;
  'order.created': OrderCreatedPayload;
  'payment.approved': PaymentApprovedPayload;
  'sale.announced': SaleAnnouncedPayload;
}

/** Identifies who is on the socket, without trusting the browser for it. */
export interface RealtimeIdentity {
  /** Stable per connection; `guest_…` for anonymous viewers. */
  readonly key: string;
  readonly userId: UserId | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface LiveRoomRef {
  readonly liveSessionId: LiveSessionId;
  readonly storeId: StoreId;
}

/** Ids used when building an order event; kept typed so callers cannot swap them. */
export interface LiveSaleRef {
  readonly liveSessionId: LiveSessionId;
  readonly orderId: OrderId;
  readonly productIds: readonly ProductId[];
}
