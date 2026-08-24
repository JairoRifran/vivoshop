import type {
  LiveSessionId,
  Order,
  OrderId,
  Product,
  ProductId,
  StockReservationLine,
  StockReservationResult,
  Store,
  StoreId,
  UserId,
} from '@vivo/domain';

/**
 * The transactional boundary for creating an order.
 *
 * Deliberately **not** a generic unit of work. A generic one would have to
 * expose every repository and would tempt every use case to open a
 * transaction; this exposes exactly the six operations that must happen
 * together when someone buys, and nothing else. Adding a seventh is a
 * conscious act.
 *
 * Everything inside a single `run` either commits or rolls back. There is no
 * path that leaves stock decremented without an order, an order without its
 * lines, or half the lines reserved.
 */
export interface OrderTransaction {
  /**
   * Claims the key for this operation. Returns `replayed` with the existing
   * order when the key was already used, so the caller can return the original
   * result instead of creating a second order.
   *
   * Concurrency is handled by the store, not by the caller: two simultaneous
   * requests with the same key must not both receive `claimed`.
   */
  claimIdempotency(claim: IdempotencyClaim): Promise<IdempotencyClaimResult>;

  /** Links the committed order back to the key, for later replays. */
  attachIdempotencyResult(scope: string, key: string, orderId: OrderId): Promise<void>;

  loadStore(storeId: StoreId): Promise<Store | null>;

  /** Reads inside the transaction, so prices cannot shift under the order. */
  loadProducts(ids: readonly ProductId[]): Promise<Product[]>;

  /**
   * Atomic, all-or-nothing conditional decrement. The single authority on
   * whether a purchase is possible.
   */
  reserveStock(lines: readonly StockReservationLine[]): Promise<StockReservationResult>;

  insertOrder(order: Order): Promise<void>;

  /** Attribution counters for the seller's live console. */
  recordLiveSale(
    liveSessionId: LiveSessionId,
    sold: ReadonlyArray<{ productId: ProductId; quantity: number }>,
  ): Promise<void>;
}

export interface IdempotencyClaim {
  /** `operation:actorId`, so two endpoints or two people never collide. */
  readonly scope: string;
  readonly key: string;
  readonly userId: UserId;
  /** Canonical fingerprint of the request payload. */
  readonly requestHash: string;
  readonly createdAt: Date;
}

export type IdempotencyClaimResult =
  /** First use of this key: proceed. */
  | { readonly status: 'claimed' }
  /**
   * Key already used with the same payload. `orderId` is null only if the
   * original attempt claimed the key and then rolled back, which cannot happen
   * when the claim shares the order's transaction.
   */
  | { readonly status: 'replayed'; readonly orderId: OrderId | null }
  /** Key reused with a materially different payload. */
  | { readonly status: 'conflict' };

/**
 * Runs the work inside one database transaction. Throwing rolls everything
 * back; returning commits.
 */
export interface OrderTransactionRunner {
  run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T>;
}
