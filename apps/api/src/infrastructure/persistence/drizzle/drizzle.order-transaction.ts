import { Inject, Injectable } from '@nestjs/common';
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
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type {
  IdempotencyClaim,
  IdempotencyClaimResult,
  OrderTransaction,
  OrderTransactionRunner,
} from '../../../application/ports/order-transaction';
import { DRIZZLE, type VivoDatabase } from './client';
import { fromOrder, fromOrderItems, toProduct, toStore } from './mappers';
import * as t from './schema';

/** The transaction handle Drizzle hands to the callback. */
type Tx = Parameters<Parameters<VivoDatabase['transaction']>[0]>[0];

@Injectable()
export class DrizzleOrderTransactionRunner implements OrderTransactionRunner {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  /**
   * One PostgreSQL transaction. Throwing from `work` aborts it, so there is no
   * path that leaves stock decremented without an order or an order without
   * its lines — the database enforces that, not our code.
   */
  async run<T>(work: (tx: OrderTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(new DrizzleOrderTransaction(tx)));
  }
}

class DrizzleOrderTransaction implements OrderTransaction {
  constructor(private readonly tx: Tx) {}

  /**
   * Insert-or-detect on the composite primary key.
   *
   * `ON CONFLICT DO NOTHING` is what makes this safe under concurrency: if
   * another transaction is inserting the same key right now, PostgreSQL blocks
   * here until it commits or aborts. If it committed we see its row and
   * replay; if it aborted the row is gone and we insert ours.
   */
  async claimIdempotency(claim: IdempotencyClaim): Promise<IdempotencyClaimResult> {
    const inserted = await this.tx
      .insert(t.idempotencyKeys)
      .values({
        scope: claim.scope,
        key: claim.key,
        userId: String(claim.userId),
        requestHash: claim.requestHash,
        orderId: null,
        createdAt: claim.createdAt,
      })
      .onConflictDoNothing()
      .returning({ scope: t.idempotencyKeys.scope });

    if (inserted.length > 0) return { status: 'claimed' };

    const [existing] = await this.tx
      .select({
        requestHash: t.idempotencyKeys.requestHash,
        orderId: t.idempotencyKeys.orderId,
      })
      .from(t.idempotencyKeys)
      .where(
        and(eq(t.idempotencyKeys.scope, claim.scope), eq(t.idempotencyKeys.key, claim.key)),
      )
      .limit(1);

    /* c8 ignore next -- the row must exist: the insert just conflicted on it. */
    if (!existing) return { status: 'claimed' };

    if (existing.requestHash !== claim.requestHash) return { status: 'conflict' };
    return { status: 'replayed', orderId: (existing.orderId as OrderId | null) ?? null };
  }

  async attachIdempotencyResult(scope: string, key: string, orderId: OrderId): Promise<void> {
    await this.tx
      .update(t.idempotencyKeys)
      .set({ orderId: String(orderId) })
      .where(and(eq(t.idempotencyKeys.scope, scope), eq(t.idempotencyKeys.key, key)));
  }

  async loadStore(storeId: StoreId): Promise<Store | null> {
    const [row] = await this.tx
      .select()
      .from(t.stores)
      .where(eq(t.stores.id, String(storeId)))
      .limit(1);
    return row ? toStore(row) : null;
  }

  async loadProducts(ids: readonly ProductId[]): Promise<Product[]> {
    if (ids.length === 0) return [];

    const rows = await this.tx
      .select()
      .from(t.products)
      .where(inArray(t.products.id, ids.map(String)));
    if (rows.length === 0) return [];

    const variantRows = await this.tx
      .select()
      .from(t.productVariants)
      .where(
        inArray(
          t.productVariants.productId,
          rows.map((row) => row.id),
        ),
      );

    const byProduct = new Map<string, typeof variantRows>();
    for (const variant of variantRows) {
      const bucket = byProduct.get(variant.productId) ?? [];
      bucket.push(variant);
      byProduct.set(variant.productId, bucket);
    }

    return rows.map((row) => toProduct(row, byProduct.get(row.id) ?? []));
  }

  /**
   * Atomic conditional decrement, one statement per line:
   *
   *   UPDATE product_variants SET stock = stock - $q
   *   WHERE id = $v AND active AND stock >= $q
   *   RETURNING stock
   *
   * The `stock >= $q` predicate is the guarantee. Two concurrent buyers both
   * reach this statement; the row lock serialises them, the second re-evaluates
   * the predicate against the already-decremented value, and it updates zero
   * rows. No read-then-write window exists to lose.
   *
   * Lines are processed in a stable order so two transactions touching the same
   * variants can never deadlock by locking them in opposite sequences.
   */
  async reserveStock(lines: readonly StockReservationLine[]): Promise<StockReservationResult> {
    const remaining: Array<{ variantId: VariantId; stock: number }> = [];

    for (const line of orderReservationLines(lines)) {
      const updated = await this.tx
        .update(t.productVariants)
        .set({ stock: sql`${t.productVariants.stock} - ${line.quantity}` })
        .where(
          and(
            eq(t.productVariants.id, String(line.variantId)),
            eq(t.productVariants.active, true),
            gte(t.productVariants.stock, line.quantity),
          ),
        )
        .returning({ stock: t.productVariants.stock });

      const row = updated[0];
      if (row) {
        remaining.push({ variantId: line.variantId, stock: row.stock });
        continue;
      }

      // Nothing updated: either the variant is gone or there was not enough.
      // Both are a failed reservation; the distinction only shapes the message.
      const [current] = await this.tx
        .select({ stock: t.productVariants.stock, active: t.productVariants.active })
        .from(t.productVariants)
        .where(eq(t.productVariants.id, String(line.variantId)))
        .limit(1);

      return {
        ok: false,
        shortfall: {
          productId: line.productId,
          variantId: line.variantId,
          requested: line.quantity,
          available: !current || !current.active ? null : current.stock,
        },
      };
    }

    return { ok: true, remaining };
  }

  async insertOrder(order: Order): Promise<void> {
    await this.tx.insert(t.orders).values(fromOrder(order));
    const items = fromOrderItems(order);
    if (items.length > 0) await this.tx.insert(t.orderItems).values(items);
  }

  async recordLiveSale(
    liveSessionId: LiveSessionId,
    sold: ReadonlyArray<{ productId: ProductId; quantity: number }>,
  ): Promise<void> {
    for (const entry of sold) {
      await this.tx
        .update(t.liveSessionProducts)
        .set({ soldCount: sql`${t.liveSessionProducts.soldCount} + ${entry.quantity}` })
        .where(
          and(
            eq(t.liveSessionProducts.liveSessionId, String(liveSessionId)),
            eq(t.liveSessionProducts.productId, String(entry.productId)),
          ),
        );
    }
  }
}
