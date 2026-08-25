import { Inject, Injectable } from '@nestjs/common';
import type { CurrencyCode } from '@vivo/config';
import type {
  Bid,
  BidId,
  BidSession,
  BidSessionId,
  LiveSessionId,
  OrderId,
  ProductId,
  StockReservationLine,
  StockReservationResult,
  StoreId,
  VariantId,
} from '@vivo/domain';
import {
  asBidId,
  asBidSessionId,
  asLiveSessionId,
  asOrderId,
  asProductId,
  asStoreId,
  asUserId,
  asVariantId,
  orderReservationLines,
} from '@vivo/domain';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type {
  BidRepository,
  BidTransaction,
  BidTransactionRunner,
} from '../../../application/ports/bids';
import { DRIZZLE, type VivoDatabase } from './client';
import * as t from './schema';

type Tx = Parameters<Parameters<VivoDatabase['transaction']>[0]>[0];
type SessionRow = typeof t.bidSessions.$inferSelect;
type BidRow = typeof t.bids.$inferSelect;

function toSession(row: SessionRow): BidSession {
  return {
    id: asBidSessionId(row.id),
    liveSessionId: asLiveSessionId(row.liveSessionId),
    storeId: asStoreId(row.storeId),
    sellerId: asUserId(row.sellerId),
    productId: asProductId(row.productId),
    variantId: asVariantId(row.variantId),
    status: row.status as BidSession['status'],
    currency: row.currency as CurrencyCode,
    referencePriceMinor: row.referencePriceMinor,
    minimumBidMinor: row.minimumBidMinor,
    minimumIncrementMinor: row.minimumIncrementMinor,
    acceptedBidId: row.acceptedBidId ? asBidId(row.acceptedBidId) : null,
    reservedUntil: row.reservedUntil,
    orderId: row.orderId ? asOrderId(row.orderId) : null,
    closedReason: row.closedReason as BidSession['closedReason'],
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  };
}

function fromSession(session: BidSession) {
  return {
    id: String(session.id),
    liveSessionId: String(session.liveSessionId),
    storeId: String(session.storeId),
    sellerId: String(session.sellerId),
    productId: String(session.productId),
    variantId: String(session.variantId),
    status: session.status,
    currency: session.currency,
    referencePriceMinor: session.referencePriceMinor,
    minimumBidMinor: session.minimumBidMinor,
    minimumIncrementMinor: session.minimumIncrementMinor,
    acceptedBidId: session.acceptedBidId ? String(session.acceptedBidId) : null,
    reservedUntil: session.reservedUntil,
    orderId: session.orderId ? String(session.orderId) : null,
    closedReason: session.closedReason,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
  };
}

function toBid(row: BidRow): Bid {
  return {
    id: asBidId(row.id),
    bidSessionId: asBidSessionId(row.bidSessionId),
    buyerId: asUserId(row.buyerId),
    buyerName: row.buyerName,
    buyerAvatarUrl: row.buyerAvatarUrl,
    amountMinor: row.amountMinor,
    currency: row.currency as CurrencyCode,
    status: row.status as Bid['status'],
    createdAt: row.createdAt,
  };
}

function fromBid(bid: Bid) {
  return {
    id: String(bid.id),
    bidSessionId: String(bid.bidSessionId),
    buyerId: String(bid.buyerId),
    buyerName: bid.buyerName,
    buyerAvatarUrl: bid.buyerAvatarUrl,
    amountMinor: bid.amountMinor,
    currency: bid.currency,
    status: bid.status,
    createdAt: bid.createdAt,
  };
}

/** Mejor oferta = mayor monto; ante empate, la más vieja. */
const LEADING_ORDER = [desc(t.bids.amountMinor), asc(t.bids.createdAt)];

@Injectable()
export class DrizzleBidRepository implements BidRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async findSession(id: BidSessionId): Promise<BidSession | null> {
    const [row] = await this.db
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.id, String(id)))
      .limit(1);
    return row ? toSession(row) : null;
  }

  async openSessionForProduct(
    liveSessionId: LiveSessionId,
    productId: ProductId,
  ): Promise<BidSession | null> {
    const [row] = await this.db
      .select()
      .from(t.bidSessions)
      .where(
        and(
          eq(t.bidSessions.liveSessionId, String(liveSessionId)),
          eq(t.bidSessions.productId, String(productId)),
          eq(t.bidSessions.status, 'open'),
        ),
      )
      .limit(1);
    return row ? toSession(row) : null;
  }

  async listSessionsForLive(liveSessionId: LiveSessionId): Promise<BidSession[]> {
    const rows = await this.db
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.liveSessionId, String(liveSessionId)))
      .orderBy(desc(t.bidSessions.openedAt));
    return rows.map(toSession);
  }

  async listSessionsForStore(storeId: StoreId, limit = 50): Promise<BidSession[]> {
    const rows = await this.db
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.storeId, String(storeId)))
      .orderBy(desc(t.bidSessions.openedAt))
      .limit(limit);
    return rows.map(toSession);
  }

  async listOpenSessions(): Promise<BidSession[]> {
    const rows = await this.db
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.status, 'open'));
    return rows.map(toSession);
  }

  async listBids(sessionId: BidSessionId): Promise<Bid[]> {
    const rows = await this.db
      .select()
      .from(t.bids)
      .where(eq(t.bids.bidSessionId, String(sessionId)))
      .orderBy(...LEADING_ORDER);
    return rows.map(toBid);
  }

  async findBid(id: BidId): Promise<Bid | null> {
    const [row] = await this.db.select().from(t.bids).where(eq(t.bids.id, String(id))).limit(1);
    return row ? toBid(row) : null;
  }

  async findSessionByOrder(orderId: OrderId): Promise<BidSession | null> {
    const [row] = await this.db
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.orderId, String(orderId)))
      .limit(1);
    return row ? toSession(row) : null;
  }

  /**
   * Reservas vencidas que todavía no produjeron un pedido.
   *
   * `orderId IS NULL` está en el `WHERE` a propósito: en cuanto existe el
   * pedido, las unidades las gobierna el pedido, y devolverlas acá inventaría
   * stock que ya se vendió.
   */
  async listLapsedReservations(now: Date): Promise<BidSession[]> {
    const rows = await this.db
      .select()
      .from(t.bidSessions)
      .where(
        and(
          eq(t.bidSessions.status, 'reserved'),
          isNull(t.bidSessions.orderId),
          lte(t.bidSessions.reservedUntil, now),
        ),
      );
    return rows.map(toSession);
  }

  async saveSession(session: BidSession): Promise<BidSession> {
    const values = fromSession(session);
    await this.db
      .insert(t.bidSessions)
      .values(values)
      .onConflictDoUpdate({ target: t.bidSessions.id, set: values });
    return session;
  }
}

/**
 * La transacción de pujas en PostgreSQL.
 *
 * `loadSessionForUpdate` hace `SELECT ... FOR UPDATE`. Esa línea es la que
 * sostiene la garantía de un solo ganador: dos aceptaciones simultáneas entran
 * a la misma fila, la segunda espera a que la primera commitee, y cuando la
 * lee ya no está `open`. La segunda falla con un código estable en vez de
 * producir un segundo ganador.
 */
@Injectable()
export class DrizzleBidTransactionRunner implements BidTransactionRunner {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async run<T>(work: (tx: BidTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(new DrizzleBidTransaction(tx)));
  }
}

class DrizzleBidTransaction implements BidTransaction {
  constructor(private readonly tx: Tx) {}

  async loadSessionForUpdate(id: BidSessionId): Promise<BidSession | null> {
    const [row] = await this.tx
      .select()
      .from(t.bidSessions)
      .where(eq(t.bidSessions.id, String(id)))
      .for('update')
      .limit(1);
    return row ? toSession(row) : null;
  }

  async saveSession(session: BidSession): Promise<BidSession> {
    await this.tx
      .update(t.bidSessions)
      .set(fromSession(session))
      .where(eq(t.bidSessions.id, String(session.id)));
    return session;
  }

  async leadingBid(sessionId: BidSessionId): Promise<Bid | null> {
    const [row] = await this.tx
      .select()
      .from(t.bids)
      .where(
        and(
          eq(t.bids.bidSessionId, String(sessionId)),
          // Una oferta vencida no puede liderar.
          sql`${t.bids.status} <> 'expired'`,
        ),
      )
      .orderBy(...LEADING_ORDER)
      .limit(1);
    return row ? toBid(row) : null;
  }

  async insertBid(bid: Bid): Promise<Bid> {
    await this.tx.insert(t.bids).values(fromBid(bid));
    return bid;
  }

  async loadBid(id: BidId): Promise<Bid | null> {
    const [row] = await this.tx.select().from(t.bids).where(eq(t.bids.id, String(id))).limit(1);
    return row ? toBid(row) : null;
  }

  async saveBid(bid: Bid): Promise<Bid> {
    await this.tx.update(t.bids).set(fromBid(bid)).where(eq(t.bids.id, String(bid.id)));
    return bid;
  }

  /**
   * El mismo decremento condicional que usa la creación de pedidos.
   *
   * `WHERE stock >= n` en el propio `UPDATE`: si no hay unidades, no actualiza
   * ninguna fila y la aceptación falla. No hay una lectura previa que pueda
   * quedar vieja entre el chequeo y la escritura.
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

  async releaseStock(lines: readonly StockReservationLine[]): Promise<void> {
    for (const line of orderReservationLines(lines)) {
      await this.tx
        .update(t.productVariants)
        .set({ stock: sql`${t.productVariants.stock} + ${line.quantity}` })
        .where(eq(t.productVariants.id, String(line.variantId)));
    }
  }
}
