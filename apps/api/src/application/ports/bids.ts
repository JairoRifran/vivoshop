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
  UserId,
} from '@vivo/domain';

/**
 * Persistencia y atomicidad del Modo Puja.
 *
 * Lo único que hace falta entender de este archivo está en `BidTransaction`:
 * las dos operaciones que mueven una puja —ofertar y aceptar— leen la sesión
 * **bajo lock** y escriben en la misma transacción. Sin eso, dos vendedores
 * tocando "aceptar" al mismo tiempo desde dos dispositivos producirían dos
 * ganadores, y dos ofertas simultáneas podrían pasar las dos la validación de
 * incremento mínimo contra la misma mejor oferta.
 */

export interface BidRepository {
  findSession(id: BidSessionId): Promise<BidSession | null>;
  /** La puja abierta de un producto en un vivo, si la hay. */
  openSessionForProduct(
    liveSessionId: LiveSessionId,
    productId: ProductId,
  ): Promise<BidSession | null>;
  /** Todas las pujas de un vivo, para pintar la pantalla. */
  listSessionsForLive(liveSessionId: LiveSessionId): Promise<BidSession[]>;
  listSessionsForStore(storeId: StoreId, limit?: number): Promise<BidSession[]>;
  /** Todas las pujas abiertas. Corta por definición: son las de vivos al aire. */
  listOpenSessions(): Promise<BidSession[]>;
  listBids(sessionId: BidSessionId): Promise<Bid[]>;
  findBid(id: BidId): Promise<Bid | null>;
  /** La puja que produjo un pedido. La usa el webhook al aprobarse el pago. */
  findSessionByOrder(orderId: OrderId): Promise<BidSession | null>;
  /**
   * Reservas cuyo plazo venció y todavía no produjeron un pedido.
   *
   * La condición "sin pedido" va en la consulta y no en el barrido: una vez
   * que existe el pedido, las unidades las gobierna el pedido, y devolverlas
   * acá sería inventar stock que ya se vendió.
   */
  listLapsedReservations(now: Date): Promise<BidSession[]>;
  saveSession(session: BidSession): Promise<BidSession>;
}

/**
 * Lo que ofertar y aceptar necesitan hacer sin que nadie se meta en el medio.
 *
 * Deliberadamente estrecho, como `OrderTransaction`: expone las seis
 * operaciones que tienen que ocurrir juntas y ninguna más. Agregar una séptima
 * es un acto consciente.
 */
export interface BidTransaction {
  /**
   * Lee la sesión y la deja tomada hasta el commit.
   *
   * Es la pieza que hace todo lo demás cierto. En PostgreSQL es un
   * `SELECT ... FOR UPDATE`; en memoria, un mutex. Las dos dan la misma
   * garantía: entre este read y el write que sigue, nadie más movió la sesión.
   */
  loadSessionForUpdate(id: BidSessionId): Promise<BidSession | null>;
  saveSession(session: BidSession): Promise<BidSession>;

  /** La mejor oferta vigente, leída dentro del lock. */
  leadingBid(sessionId: BidSessionId): Promise<Bid | null>;
  insertBid(bid: Bid): Promise<Bid>;
  loadBid(id: BidId): Promise<Bid | null>;
  saveBid(bid: Bid): Promise<Bid>;

  /**
   * Toma la unidad al aceptar. Es el mismo decremento condicional y atómico
   * que usa la creación de pedidos: si no hay stock, aceptar falla.
   */
  reserveStock(lines: readonly StockReservationLine[]): Promise<StockReservationResult>;
  /** La devuelve cuando la reserva vence sin pedido. */
  releaseStock(lines: readonly StockReservationLine[]): Promise<void>;
}

export interface BidTransactionRunner {
  run<T>(work: (tx: BidTransaction) => Promise<T>): Promise<T>;
}

export const BID_REPOSITORY = Symbol('BidRepository');
export const BID_TRANSACTION_RUNNER = Symbol('BidTransactionRunner');

/** Reexportado para que los servicios importen de un solo lado. */
export type { UserId };
