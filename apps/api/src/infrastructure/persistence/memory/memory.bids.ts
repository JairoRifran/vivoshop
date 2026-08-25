import { Injectable } from '@nestjs/common';
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
} from '@vivo/domain';
import { isReservationExpired, leadingBid, orderReservationLines } from '@vivo/domain';
import type {
  BidRepository,
  BidTransaction,
  BidTransactionRunner,
} from '../../../application/ports/bids';
import { MemoryDatabase } from './memory-database';

@Injectable()
export class MemoryBidRepository implements BidRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async findSession(id: BidSessionId): Promise<BidSession | null> {
    return this.db.bidSessions.get(String(id)) ?? null;
  }

  async openSessionForProduct(
    liveSessionId: LiveSessionId,
    productId: ProductId,
  ): Promise<BidSession | null> {
    for (const session of this.db.bidSessions.values()) {
      if (
        session.status === 'open' &&
        String(session.liveSessionId) === String(liveSessionId) &&
        String(session.productId) === String(productId)
      ) {
        return session;
      }
    }
    return null;
  }

  async listSessionsForLive(liveSessionId: LiveSessionId): Promise<BidSession[]> {
    return [...this.db.bidSessions.values()]
      .filter((session) => String(session.liveSessionId) === String(liveSessionId))
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }

  async listSessionsForStore(storeId: StoreId, limit = 50): Promise<BidSession[]> {
    return [...this.db.bidSessions.values()]
      .filter((session) => String(session.storeId) === String(storeId))
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
      .slice(0, limit);
  }

  async listOpenSessions(): Promise<BidSession[]> {
    return [...this.db.bidSessions.values()].filter((session) => session.status === 'open');
  }

  async listBids(sessionId: BidSessionId): Promise<Bid[]> {
    return [...this.db.bids.values()]
      .filter((bid) => String(bid.bidSessionId) === String(sessionId))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findBid(id: BidId): Promise<Bid | null> {
    return this.db.bids.get(String(id)) ?? null;
  }

  async findSessionByOrder(orderId: OrderId): Promise<BidSession | null> {
    for (const session of this.db.bidSessions.values()) {
      if (session.orderId && String(session.orderId) === String(orderId)) return session;
    }
    return null;
  }

  async listLapsedReservations(now: Date): Promise<BidSession[]> {
    return [...this.db.bidSessions.values()].filter((session) =>
      isReservationExpired(session, now),
    );
  }

  async saveSession(session: BidSession): Promise<BidSession> {
    this.db.bidSessions.set(String(session.id), session);
    return session;
  }
}

/**
 * La transacción de pujas en memoria.
 *
 * Mismo diseño que las otras dos: un mutex que serializa —porque `await` es un
 * punto de cesión y dos peticiones se interleavan justo entre leer la mejor
 * oferta y escribir la nueva— y escrituras bufferizadas para que un fallo no
 * deje media operación hecha.
 */
@Injectable()
export class MemoryBidTransactionRunner implements BidTransactionRunner {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly db: MemoryDatabase) {}

  async run<T>(work: (tx: BidTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const transaction = new MemoryBidTransaction(this.db);
    try {
      const result = await work(transaction);
      transaction.commit();
      return result;
    } catch (error) {
      transaction.discard();
      throw error;
    } finally {
      release();
    }
  }
}

class MemoryBidTransaction implements BidTransaction {
  private readonly writes: Array<() => void> = [];

  constructor(private readonly db: MemoryDatabase) {}

  commit(): void {
    for (const write of this.writes) write();
    this.writes.length = 0;
  }

  discard(): void {
    this.writes.length = 0;
  }

  /** El lock lo da el mutex del runner: acá alcanza con leer. */
  async loadSessionForUpdate(id: BidSessionId): Promise<BidSession | null> {
    return this.db.bidSessions.get(String(id)) ?? null;
  }

  async saveSession(session: BidSession): Promise<BidSession> {
    this.writes.push(() => this.db.bidSessions.set(String(session.id), session));
    return session;
  }

  async leadingBid(sessionId: BidSessionId): Promise<Bid | null> {
    const bids = [...this.db.bids.values()].filter(
      (bid) => String(bid.bidSessionId) === String(sessionId),
    );
    return leadingBid(bids);
  }

  async insertBid(bid: Bid): Promise<Bid> {
    this.writes.push(() => this.db.bids.set(String(bid.id), bid));
    return bid;
  }

  async loadBid(id: BidId): Promise<Bid | null> {
    return this.db.bids.get(String(id)) ?? null;
  }

  async saveBid(bid: Bid): Promise<Bid> {
    this.writes.push(() => this.db.bids.set(String(bid.id), bid));
    return bid;
  }

  /** Todo o nada, igual que la reserva de un pedido. */
  async reserveStock(lines: readonly StockReservationLine[]): Promise<StockReservationResult> {
    const ordered = orderReservationLines(lines);

    for (const line of ordered) {
      const product = this.db.products.get(String(line.productId));
      const variant = product?.variants.find(
        (candidate) => String(candidate.id) === String(line.variantId),
      );

      if (!product || !variant || !variant.active || variant.stock < line.quantity) {
        return {
          ok: false,
          shortfall: {
            productId: line.productId,
            variantId: line.variantId,
            requested: line.quantity,
            available: variant && variant.active ? variant.stock : null,
          },
        };
      }
    }

    this.writes.push(() => this.applyStockDelta(ordered, -1));
    return {
      ok: true,
      remaining: ordered.map((line) => ({ variantId: line.variantId, stock: 0 })),
    };
  }

  async releaseStock(lines: readonly StockReservationLine[]): Promise<void> {
    this.writes.push(() => this.applyStockDelta(orderReservationLines(lines), 1));
  }

  private applyStockDelta(lines: readonly StockReservationLine[], sign: 1 | -1): void {
    for (const line of lines) {
      const product = this.db.products.get(String(line.productId));
      if (!product) continue;
      this.db.products.set(String(product.id), {
        ...product,
        variants: product.variants.map((variant) =>
          String(variant.id) === String(line.variantId)
            ? { ...variant, stock: variant.stock + sign * line.quantity }
            : variant,
        ),
      });
    }
  }
}
