import { Injectable } from '@nestjs/common';
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
  VariantId,
} from '@vivo/domain';
import { orderReservationLines } from '@vivo/domain';
import type {
  IdempotencyClaim,
  IdempotencyClaimResult,
  OrderTransaction,
  OrderTransactionRunner,
} from '../../../application/ports/order-transaction';
import { MemoryDatabase, type IdempotencyRecord } from './memory-database';

/**
 * Serialises order creation.
 *
 * JavaScript is single threaded, but `await` is a yield point: two overlapping
 * requests will interleave between a stock read and the write that follows it,
 * which is the exact race PostgreSQL solves with row locks. A promise-chain
 * mutex gives the in-memory driver the same guarantee for the same reason.
 *
 * Deliberately coarse. Order creation is short, and a per-variant lock would
 * add a deadlock class for no measurable gain at this scale.
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

/** A write buffered until the transaction commits. */
type PendingWrite = () => void;

@Injectable()
export class MemoryOrderTransactionRunner implements OrderTransactionRunner {
  private readonly mutex = new Mutex();

  constructor(private readonly db: MemoryDatabase) {}

  async run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      const transaction = new MemoryOrderTransaction(this.db);
      try {
        const result = await work(transaction);
        transaction.commit();
        return result;
      } catch (error) {
        // Nothing was applied: every write was buffered, so there is no
        // partial state to undo.
        transaction.discard();
        throw error;
      }
    });
  }
}

class MemoryOrderTransaction implements OrderTransaction {
  private readonly writes: PendingWrite[] = [];
  /** Undo for the few things written eagerly rather than buffered. */
  private readonly rollbacks: PendingWrite[] = [];
  /** Stock already taken within this transaction, so multi-line orders see it. */
  private readonly reservedInTx = new Map<string, number>();

  constructor(private readonly db: MemoryDatabase) {}

  commit(): void {
    for (const write of this.writes) write();
    this.writes.length = 0;
    this.rollbacks.length = 0;
  }

  discard(): void {
    // Reverse order, like unwinding a stack.
    for (const rollback of this.rollbacks.reverse()) rollback();
    this.rollbacks.length = 0;
    this.writes.length = 0;
    this.reservedInTx.clear();
  }

  async claimIdempotency(claim: IdempotencyClaim): Promise<IdempotencyClaimResult> {
    const id = MemoryDatabase.idempotencyKey(claim.scope, claim.key);
    const existing = this.db.idempotency.get(id);

    if (existing) {
      if (existing.requestHash !== claim.requestHash) return { status: 'conflict' };
      return { status: 'replayed', orderId: (existing.orderId as OrderId | null) ?? null };
    }

    // Written immediately rather than buffered: the mutex guarantees no other
    // creation runs concurrently, and a rollback removes it below.
    const record: IdempotencyRecord = {
      scope: claim.scope,
      key: claim.key,
      userId: String(claim.userId),
      requestHash: claim.requestHash,
      orderId: null,
      createdAt: claim.createdAt,
    };
    this.db.idempotency.set(id, record);
    // On rollback the claim must disappear, so a genuine retry can succeed.
    this.rollbacks.push(() => this.db.idempotency.delete(id));

    return { status: 'claimed' };
  }

  async attachIdempotencyResult(scope: string, key: string, orderId: OrderId): Promise<void> {
    const id = MemoryDatabase.idempotencyKey(scope, key);
    const existing = this.db.idempotency.get(id);
    if (!existing) return;
    this.writes.push(() => this.db.idempotency.set(id, { ...existing, orderId }));
  }

  async loadStore(storeId: StoreId): Promise<Store | null> {
    return this.db.stores.get(String(storeId)) ?? null;
  }

  async loadProducts(ids: readonly ProductId[]): Promise<Product[]> {
    return ids
      .map((id) => this.db.products.get(String(id)))
      .filter((product): product is Product => Boolean(product));
  }

  /**
   * All-or-nothing. Every line is checked against the live value minus what
   * this same transaction already took, and only then are the decrements
   * buffered.
   */
  async reserveStock(lines: readonly StockReservationLine[]): Promise<StockReservationResult> {
    const ordered = orderReservationLines(lines);
    const remaining: Array<{ variantId: VariantId; stock: number }> = [];
    const decrements = new Map<string, number>();

    for (const line of ordered) {
      const product = this.db.products.get(String(line.productId));
      const variant = product?.variants.find(
        (candidate) => String(candidate.id) === String(line.variantId),
      );

      if (!product || !variant || !variant.active) {
        return {
          ok: false,
          shortfall: {
            productId: line.productId,
            variantId: line.variantId,
            requested: line.quantity,
            available: null,
          },
        };
      }

      const key = String(line.variantId);
      const alreadyTaken = (this.reservedInTx.get(key) ?? 0) + (decrements.get(key) ?? 0);
      const available = variant.stock - alreadyTaken;

      if (available < line.quantity) {
        return {
          ok: false,
          shortfall: {
            productId: line.productId,
            variantId: line.variantId,
            requested: line.quantity,
            available: Math.max(0, available),
          },
        };
      }

      decrements.set(key, (decrements.get(key) ?? 0) + line.quantity);
      remaining.push({ variantId: line.variantId, stock: available - line.quantity });
    }

    for (const [key, quantity] of decrements) {
      this.reservedInTx.set(key, (this.reservedInTx.get(key) ?? 0) + quantity);
    }

    this.writes.push(() => {
      for (const line of ordered) {
        const product = this.db.products.get(String(line.productId));
        if (!product) continue;
        this.db.products.set(String(product.id), {
          ...product,
          variants: product.variants.map((variant) =>
            String(variant.id) === String(line.variantId)
              ? { ...variant, stock: variant.stock - line.quantity }
              : variant,
          ),
        });
      }
    });

    return { ok: true, remaining };
  }

  async insertOrder(order: Order): Promise<void> {
    this.writes.push(() => this.db.orders.set(String(order.id), order));
  }

  async recordLiveSale(
    liveSessionId: LiveSessionId,
    sold: ReadonlyArray<{ productId: ProductId; quantity: number }>,
  ): Promise<void> {
    this.writes.push(() => {
      const session = this.db.liveSessions.get(String(liveSessionId));
      if (!session) return;

      const byProduct = new Map(sold.map((entry) => [String(entry.productId), entry.quantity]));
      this.db.liveSessions.set(String(liveSessionId), {
        ...session,
        products: session.products.map((entry) => ({
          ...entry,
          soldCount: entry.soldCount + (byProduct.get(String(entry.productId)) ?? 0),
        })),
      });
    });
  }
}
