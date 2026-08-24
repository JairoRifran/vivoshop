import type {
  ChatMessagePayload,
  LiveSessionId,
  LiveStatePayload,
  OrderCreatedPayload,
  PaymentApprovedPayload,
  ProductFeaturedPayload,
  ReactionBurstPayload,
  SaleAnnouncedPayload,
  StoreId,
  ViewerCountPayload,
} from '@vivo/domain';

/**
 * Fan-out of business events to connected clients.
 *
 * A port, not the gateway itself, for the usual reason: `LiveService` must not
 * import Socket.IO. It also means the whole application can be tested without
 * a socket server, and that swapping the transport — for Server-Sent Events,
 * or for a hosted pub/sub when there is more than one API process — is an
 * infrastructure change.
 *
 * Every method is fire-and-forget from the caller's point of view. A failure
 * to notify must never fail the operation that succeeded: a buyer's order is
 * placed whether or not the seller's console heard about it in time.
 */
export interface RealtimePublisher {
  liveStateChanged(payload: LiveStatePayload): Promise<void>;
  featuredProductChanged(payload: ProductFeaturedPayload): Promise<void>;
  chatMessagePosted(payload: ChatMessagePayload): Promise<void>;
  reactionBurst(payload: ReactionBurstPayload): Promise<void>;
  viewerCountChanged(payload: ViewerCountPayload): Promise<void>;

  /** Private to the seller's console. Never reaches viewers. */
  orderCreated(storeId: StoreId, payload: OrderCreatedPayload): Promise<void>;

  /**
   * "Venta confirmada": el pago se aprobó de verdad. Privado del vendedor.
   *
   * Separado de `orderCreated` porque son hechos distintos. Un pedido creado
   * es alguien que apretó "comprar"; esto es plata que existe.
   */
  paymentApproved(storeId: StoreId, payload: PaymentApprovedPayload): Promise<void>;

  /** Public and anonymised: "alguien compró X". Carries no buyer data. */
  saleAnnounced(payload: SaleAnnouncedPayload): Promise<void>;

  /** Number of sockets currently attached to a session's room. */
  roomSize(liveSessionId: LiveSessionId): Promise<number>;
}
