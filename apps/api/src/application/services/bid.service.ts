import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Bid,
  BidId,
  BidSession,
  BidSessionId,
  LiveSession,
  LiveSessionId,
  OrderId,
  Store,
  UserId,
} from '@vivo/domain';
import {
  ACTIVE_LIVE_STATUSES,
  BID_UNITS,
  asBidId,
  asBidSessionId,
  asLiveSessionId,
  asProductId,
  asVariantId,
  assertBidAcceptable,
  assertBidSessionTransition,
  assertCanAccept,
  assertNotOwnBid,
  bidRateLimitError,
  consumeBidToken,
  findVariant,
  canCheckoutBid,
  leadingBid,
  newBidBucket,
  nextMinimumBid,
  reservationDeadline,
  stockShortfallError,
  variantPrice,
  withOutcomes,
  type BidBucket,
} from '@vivo/domain';
import type { OpenBidSessionRequest, SubmitBidRequest } from '@vivo/shared';
import { ENV, type AppEnv } from '../../config/env';
import type { BidRepository, BidTransaction, BidTransactionRunner } from '../ports/bids';
import { BID_REPOSITORY, BID_TRANSACTION_RUNNER } from '../ports/bids';
import type { CacheStore, Clock, IdGenerator } from '../ports/infrastructure';
import type { RealtimePublisher } from '../ports/realtime';
import type { ProductRepository, UserRepository } from '../ports/repositories';
import {
  CACHE_STORE,
  CLOCK,
  ID_GENERATOR,
  PRODUCT_REPOSITORY,
  REALTIME_PUBLISHER,
  USER_REPOSITORY,
} from '../ports/tokens';
import { LiveService } from './live.service';
import { StoreService } from './store.service';

/**
 * Modo Puja.
 *
 * El vendedor abre, la gente oferta, el vendedor acepta la que le sirve. No hay
 * reloj que decida por nadie y el precio de referencia no obliga: se puede
 * aceptar por debajo, que es el caso normal.
 *
 * Dos reglas gobiernan el archivo:
 *
 *  1. **El servidor es la autoridad.** Un `bidId` y un monto que llegan por la
 *     red son una intención, no un hecho. Todo —que el vivo esté al aire, que
 *     la sesión siga abierta, que el monto supere el mínimo vigente, que quien
 *     oferta no sea el dueño— se verifica acá. Socket.IO no acepta ofertas: las
 *     ofertas entran por HTTP y salen por el socket.
 *
 *  2. **Ofertar y aceptar ocurren bajo lock.** Las dos leen la sesión dentro de
 *     una transacción que la deja tomada. Sin eso, dos vendedores tocando
 *     "aceptar" a la vez producirían dos ganadores.
 */
@Injectable()
export class BidService {
  private readonly logger = new Logger(BidService.name);

  constructor(
    @Inject(BID_REPOSITORY) private readonly bids: BidRepository,
    @Inject(BID_TRANSACTION_RUNNER) private readonly transactions: BidTransactionRunner,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(ENV) private readonly env: AppEnv,
    private readonly stores: StoreService,
    private readonly live: LiveService,
  ) {}

  // --- Lectura ------------------------------------------------------------

  async sessionsForLive(liveSessionId: LiveSessionId): Promise<BidSession[]> {
    return this.bids.listSessionsForLive(liveSessionId);
  }

  async requireSession(id: BidSessionId): Promise<BidSession> {
    const session = await this.bids.findSession(id);
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa puja no existe.' });
    }
    return session;
  }

  async bidsFor(sessionId: BidSessionId) {
    const session = await this.requireSession(sessionId);
    const bids = await this.bids.listBids(sessionId);
    return { session, bids, outcomes: withOutcomes(bids, session) };
  }

  /** La oferta viva de quien está mirando, para que la UI sepa dónde está parado. */
  async ownBid(sessionId: BidSessionId, buyerId: UserId): Promise<Bid | null> {
    const bids = await this.bids.listBids(sessionId);
    const mine = bids.filter((bid) => bid.buyerId === buyerId);
    return leadingBid(mine);
  }

  // --- Abrir ---------------------------------------------------------------

  /**
   * Pone un producto en puja.
   *
   * El precio de referencia se congela desde el catálogo y no se acepta del
   * cliente: es lo que se le va a mostrar a cada persona que oferte, y dejar
   * que el navegador lo proponga sería dejar que invente qué "vale" el producto.
   */
  async open(sellerId: UserId, input: OpenBidSessionRequest): Promise<BidSession> {
    const store = await this.stores.requireOwned(sellerId);
    const live = await this.requireOwnLive(sellerId, asLiveSessionId(input.liveSessionId));

    const product = await this.products.findById(asProductId(input.productId));
    if (!product || product.storeId !== store.id) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ese producto no existe.' });
    }

    const variant = input.variantId
      ? findVariant(product, asVariantId(input.variantId))
      : (product.variants.find((candidate) => candidate.active && candidate.stock > 0) ??
        product.variants[0]);

    if (!variant) {
      throw new BadRequestException({
        code: 'VARIANT_UNAVAILABLE',
        message: 'Ese producto no tiene una variante disponible para pujar.',
      });
    }

    const existing = await this.bids.openSessionForProduct(live.id, product.id);
    if (existing) {
      // Reabrir la misma pantalla dos veces no abre dos pujas.
      return existing;
    }

    const now = this.clock.now();
    const session: BidSession = {
      id: asBidSessionId(this.ids.generate('bs')),
      liveSessionId: live.id,
      storeId: store.id,
      sellerId,
      productId: product.id,
      variantId: variant.id,
      status: 'open',
      currency: product.currency,
      referencePriceMinor: variantPrice(product, variant).amountMinor,
      minimumBidMinor: input.minimumBidMinor ?? null,
      minimumIncrementMinor: input.minimumIncrementMinor ?? null,
      acceptedBidId: null,
      reservedUntil: null,
      orderId: null,
      closedReason: null,
      openedAt: now,
      closedAt: null,
    };

    const saved = await this.bids.saveSession(session);
    await this.announce(saved, () =>
      this.realtime.bidOpened({
        liveSessionId: String(saved.liveSessionId),
        bidSessionId: String(saved.id),
        productId: String(saved.productId),
        productTitle: product.title,
        productImageUrl: product.images[0]?.url ?? null,
        currency: saved.currency,
        referencePriceMinor: saved.referencePriceMinor,
        minimumBidMinor: saved.minimumBidMinor,
        minimumIncrementMinor: saved.minimumIncrementMinor,
      }),
    );

    return saved;
  }

  // --- Ofertar ---------------------------------------------------------------

  /**
   * Registra una oferta.
   *
   * Todo lo que decide si vale ocurre **dentro** de la transacción, con la
   * sesión tomada: leer la mejor oferta afuera y validar adentro dejaría pasar
   * dos ofertas que compiten contra el mismo líder viejo.
   */
  async submit(
    buyerId: UserId,
    sessionId: BidSessionId,
    input: SubmitBidRequest,
  ): Promise<{ bid: Bid; session: BidSession; leadingChanged: boolean }> {
    await this.assertWithinRate(buyerId);

    const buyer = await this.users.findById(buyerId);
    /* c8 ignore next -- el token ya se validó contra un usuario existente. */
    if (!buyer) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario inexistente.' });

    const outcome = await this.transactions.run(async (tx) =>
      this.submitInsideTransaction(tx, { buyerId, buyer, sessionId, input }),
    );

    await this.announce(outcome.session, async () => {
      await this.realtime.bidPlaced({
        liveSessionId: String(outcome.session.liveSessionId),
        bidSessionId: String(outcome.session.id),
        bidId: String(outcome.bid.id),
        bidderName: outcome.bid.buyerName,
        bidderAvatarUrl: outcome.bid.buyerAvatarUrl,
        amountMinor: outcome.bid.amountMinor,
        currency: outcome.bid.currency,
      });

      if (outcome.leadingChanged) {
        await this.realtime.bidLeadingChanged({
          liveSessionId: String(outcome.session.liveSessionId),
          bidSessionId: String(outcome.session.id),
          bidId: String(outcome.bid.id),
          bidderName: outcome.bid.buyerName,
          bidderAvatarUrl: outcome.bid.buyerAvatarUrl,
          amountMinor: outcome.bid.amountMinor,
          currency: outcome.bid.currency,
          nextMinimumMinor: nextMinimumBid(outcome.session, outcome.bid),
        });
      }
    });

    return outcome;
  }

  private async submitInsideTransaction(
    tx: BidTransaction,
    context: {
      buyerId: UserId;
      buyer: { name: string; avatarUrl: string | null };
      sessionId: BidSessionId;
      input: SubmitBidRequest;
    },
  ): Promise<{ bid: Bid; session: BidSession; leadingChanged: boolean }> {
    const session = await tx.loadSessionForUpdate(context.sessionId);
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa puja no existe.' });
    }

    // El vivo tiene que seguir al aire. Se lee acá y no antes para que una
    // transmisión que termina mientras la oferta viaja no se cuele.
    await this.assertLiveIsOn(session.liveSessionId);
    assertNotOwnBid(session, context.buyerId);

    const leading = await tx.leadingBid(session.id);
    assertBidAcceptable({
      session,
      leading,
      amountMinor: context.input.amountMinor,
      currency: session.currency,
    });

    const bid: Bid = {
      id: asBidId(this.ids.generate('bid')),
      bidSessionId: session.id,
      buyerId: context.buyerId,
      buyerName: context.buyer.name,
      buyerAvatarUrl: context.buyer.avatarUrl,
      amountMinor: context.input.amountMinor,
      currency: session.currency,
      status: 'active',
      createdAt: this.clock.now(),
    };

    await tx.insertBid(bid);
    return { bid, session, leadingChanged: !leading || bid.amountMinor > leading.amountMinor };
  }

  // --- Aceptar ------------------------------------------------------------------

  /**
   * El vendedor acepta una oferta. **Un solo ganador, siempre.**
   *
   * Todo pasa en una transacción con la sesión tomada: se verifica que siga
   * abierta, que la oferta le pertenezca y esté viva, se marca aceptada, se
   * cierra la sesión a nuevas ofertas y se reserva la unidad. Dos aceptaciones
   * simultáneas entran a la misma fila; la segunda encuentra la sesión ya
   * `reserved` y falla con un código estable.
   *
   * Es idempotente para la *misma* oferta: reintentar tras un timeout de red
   * devuelve el mismo ganador en vez de un error confuso.
   */
  async accept(
    sellerId: UserId,
    sessionId: BidSessionId,
    bidId: BidId,
  ): Promise<{ session: BidSession; bid: Bid }> {
    const outcome = await this.transactions.run(async (tx) => {
      const session = await tx.loadSessionForUpdate(sessionId);
      if (!session) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa puja no existe.' });
      }
      if (session.sellerId !== sellerId) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa puja no existe.' });
      }

      const bid = await tx.loadBid(bidId);
      if (!bid) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa oferta no existe.' });
      }

      // Reintento de la misma aceptación: mismo resultado, sin error.
      if (session.acceptedBidId && String(session.acceptedBidId) === String(bidId)) {
        return { session, bid, alreadyAccepted: true };
      }

      assertCanAccept(session, bid);
      assertBidSessionTransition(session.status, 'reserved');

      const reserved = await tx.reserveStock([
        { productId: session.productId, variantId: session.variantId, quantity: BID_UNITS },
      ]);
      if (!reserved.ok) throw stockShortfallError(reserved.shortfall);

      const now = this.clock.now();
      const accepted = await tx.saveBid({ ...bid, status: 'accepted' });
      const updated = await tx.saveSession({
        ...session,
        status: 'reserved',
        acceptedBidId: bid.id,
        reservedUntil: reservationDeadline(now, this.env.BID_RESERVATION_TTL_SECONDS),
      });

      return { session: updated, bid: accepted, alreadyAccepted: false };
    });

    if (!outcome.alreadyAccepted) {
      await this.announce(outcome.session, () =>
        this.realtime.bidAccepted({
          liveSessionId: String(outcome.session.liveSessionId),
          bidSessionId: String(outcome.session.id),
          bidId: String(outcome.bid.id),
          bidderName: outcome.bid.buyerName,
          bidderAvatarUrl: outcome.bid.buyerAvatarUrl,
          amountMinor: outcome.bid.amountMinor,
          currency: outcome.bid.currency,
          reservedUntil: outcome.session.reservedUntil?.toISOString() ?? null,
        }),
      );
    }

    return { session: outcome.session, bid: outcome.bid };
  }

  // --- Cerrar y reabrir ------------------------------------------------------------

  /** Termina la puja sin vender. Es una decisión legítima, no un fallo. */
  async close(sellerId: UserId, sessionId: BidSessionId): Promise<BidSession> {
    const session = await this.requireOwnSession(sellerId, sessionId);
    return this.closeSession(session, 'seller');
  }

  /**
   * Reabre una puja cuyo ganador no pagó.
   *
   * Las demás ofertas siguen vivas, y eso es todo lo que hace falta para
   * "ofrecerle al segundo": el vendedor reabre y acepta la que sigue. No hay
   * un camino separado para eso —ni debería haberlo— porque sería el mismo
   * código con otro nombre, y porque cobrarle automáticamente al segundo sin
   * que el vendedor decida es exactamente lo que no queremos.
   */
  async reopen(sellerId: UserId, sessionId: BidSessionId): Promise<BidSession> {
    const session = await this.requireOwnSession(sellerId, sessionId);
    assertBidSessionTransition(session.status, 'open');

    const reopened = await this.bids.saveSession({
      ...session,
      status: 'open',
      acceptedBidId: null,
      reservedUntil: null,
      closedReason: null,
    });

    const product = await this.products.findById(reopened.productId);
    await this.announce(reopened, () =>
      this.realtime.bidOpened({
        liveSessionId: String(reopened.liveSessionId),
        bidSessionId: String(reopened.id),
        productId: String(reopened.productId),
        productTitle: product?.title ?? '',
        productImageUrl: product?.images[0]?.url ?? null,
        currency: reopened.currency,
        referencePriceMinor: reopened.referencePriceMinor,
        minimumBidMinor: reopened.minimumBidMinor,
        minimumIncrementMinor: reopened.minimumIncrementMinor,
      }),
    );

    return reopened;
  }

  /**
   * Cierra las pujas que quedaron abiertas con el vivo ya terminado.
   *
   * Un barrido y no un gancho en "terminar transmisión", por el mismo motivo
   * que el resto de los barridos de este proyecto: un proceso que muere entre
   * el fin del vivo y el cierre de la puja dejaría una puja abierta para
   * siempre, y un gancho no sobrevive a eso. Esto lee el estado actual y por
   * lo tanto es correcto después de cualquier reinicio.
   *
   * No es lo que impide ofertar sobre un vivo terminado: eso ya lo impide
   * `submit`, que verifica el vivo dentro de la transacción. Esto ordena la
   * pantalla.
   */
  async closeSessionsOfEndedLives(): Promise<number> {
    const open = await this.bids.listOpenSessions();
    let closed = 0;

    for (const session of open) {
      const live = await this.live.findSession(session.liveSessionId);
      if (live && ACTIVE_LIVE_STATUSES.includes(live.status)) continue;

      try {
        await this.closeSession(session, 'live_ended');
        closed += 1;
      } catch (error) {
        this.logger.warn(`No se pudo cerrar la puja ${session.id}: ${String(error)}`);
      }
    }

    return closed;
  }

  private async closeSession(session: BidSession, reason: BidSession['closedReason']) {
    assertBidSessionTransition(session.status, 'closed');

    const closed = await this.bids.saveSession({
      ...session,
      status: 'closed',
      closedReason: reason,
      closedAt: this.clock.now(),
    });

    await this.announce(closed, () =>
      this.realtime.bidClosed({
        liveSessionId: String(closed.liveSessionId),
        bidSessionId: String(closed.id),
        reason: reason ?? 'seller',
        sold: false,
      }),
    );

    return closed;
  }

  // --- Reserva vencida ---------------------------------------------------------------

  /**
   * Devuelve a la góndola lo que un ganador no pagó a tiempo.
   *
   * La sesión queda en `expired`, no cerrada: es el vendedor quien decide si
   * reabre o termina. Devolver el stock sí es urgente —el producto no puede
   * quedar trabado porque alguien abandonó el checkout— y por eso lo hace el
   * barrido y no una acción del vendedor.
   */
  async expireLapsedReservations(): Promise<number> {
    const now = this.clock.now();
    const lapsed = await this.bids.listLapsedReservations(now);
    let expired = 0;

    for (const session of lapsed) {
      try {
        const updated = await this.transactions.run(async (tx) => {
          const current = await tx.loadSessionForUpdate(session.id);
          // Puede haber pagado justo entre la consulta y el lock.
          if (!current || current.status !== 'reserved' || current.orderId) return null;

          await tx.releaseStock([
            { productId: current.productId, variantId: current.variantId, quantity: BID_UNITS },
          ]);

          if (current.acceptedBidId) {
            const bid = await tx.loadBid(current.acceptedBidId);
            if (bid) await tx.saveBid({ ...bid, status: 'expired' });
          }

          assertBidSessionTransition(current.status, 'expired');
          return tx.saveSession({
            ...current,
            status: 'expired',
            acceptedBidId: null,
            reservedUntil: null,
          });
        });

        if (!updated) continue;
        expired += 1;

        await this.realtime
          .bidReservationExpired({
            liveSessionId: String(updated.liveSessionId),
            bidSessionId: String(updated.id),
          })
          .catch(() => undefined);
      } catch (error) {
        this.logger.warn(`No se pudo vencer la reserva ${session.id}: ${String(error)}`);
      }
    }

    return expired;
  }

  // --- Enganche con el pedido -------------------------------------------------------

  /**
   * Valida que este comprador pueda pagar esta oferta, y devuelve el precio.
   *
   * Lo llama el checkout con un `bidId` que vino del navegador. **El monto no
   * viaja nunca**: sale de la base. Si viniera en la petición, cualquiera
   * compraría a su propio precio.
   */
  async resolveAcceptedPrice(
    buyerId: UserId,
    bidId: BidId,
  ): Promise<{ session: BidSession; bid: Bid }> {
    const bid = await this.bids.findBid(bidId);
    if (!bid || bid.buyerId !== buyerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa oferta no existe.' });
    }

    const session = await this.requireSession(bid.bidSessionId);

    if (String(session.acceptedBidId ?? '') !== String(bid.id) || bid.status !== 'accepted') {
      throw new ConflictException({
        code: 'BID_NOT_ACTIVE',
        message: 'Esa oferta no fue la aceptada.',
      });
    }
    if (session.orderId) {
      /**
       * Código propio, y con el id del pedido adentro.
       *
       * No es lo mismo "esa oferta no es la aceptada" que "ya la compraste":
       * lo primero es un error, lo segundo es alguien que volvió atrás o
       * refrescó el checkout después de pagar. Con el mismo código, la pantalla
       * no podía distinguirlos y mostraba un error a quien acababa de comprar
       * bien. El id viaja porque el llamador ya demostró ser el dueño de la
       * oferta unas líneas más arriba.
       */
      throw new ConflictException({
        code: 'BID_ALREADY_ORDERED',
        message: 'Esta puja ya tiene un pedido.',
        details: { orderId: String(session.orderId) },
      });
    }
    if (!canCheckoutBid(session, this.clock.now())) {
      throw new ConflictException({
        code: 'BID_RESERVATION_EXPIRED',
        message: 'Se venció el tiempo para pagar esta oferta.',
      });
    }

    return { session, bid };
  }

  /** Ata el pedido a la puja. A partir de acá, el stock lo gobierna el pedido. */
  async attachOrder(sessionId: BidSessionId, orderId: BidSession['orderId']): Promise<void> {
    const session = await this.bids.findSession(sessionId);
    if (!session) return;
    await this.bids.saveSession({ ...session, orderId });
  }

  /**
   * El pago se aprobó: la puja terminó en venta.
   *
   * No lanza cuando el pedido no salió de una puja, que es el caso normal: lo
   * llama el webhook de pagos para *todos* los pagos aprobados, y un cobro de
   * checkout tradicional simplemente no tiene sesión que cerrar.
   */
  async markSold(orderId: OrderId): Promise<void> {
    const session = await this.bids.findSessionByOrder(orderId);
    if (!session || session.status !== 'reserved') return;

    assertBidSessionTransition(session.status, 'sold');
    const sold = await this.bids.saveSession({
      ...session,
      status: 'sold',
      closedAt: this.clock.now(),
    });

    const winner = sold.acceptedBidId ? await this.bids.findBid(sold.acceptedBidId) : null;
    await this.realtime
      .bidSold({
        liveSessionId: String(sold.liveSessionId),
        bidSessionId: String(sold.id),
        bidderName: winner?.buyerName ?? '',
        amountMinor: winner?.amountMinor ?? 0,
        currency: sold.currency,
      })
      .catch(() => undefined);
  }

  // --- Internos --------------------------------------------------------------------

  private async requireOwnSession(sellerId: UserId, id: BidSessionId): Promise<BidSession> {
    const session = await this.requireSession(id);
    if (session.sellerId !== sellerId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa puja no existe.' });
    }
    return session;
  }

  private async requireOwnLive(sellerId: UserId, id: LiveSessionId): Promise<LiveSession> {
    const session = await this.live.findSession(id);
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa transmisión no existe.' });
    }
    if (!(await this.live.isBroadcasterFor(session, sellerId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Esa transmisión no existe.' });
    }
    return session;
  }

  private async assertLiveIsOn(id: LiveSessionId): Promise<void> {
    const session = await this.live.findSession(id);
    if (!session || !ACTIVE_LIVE_STATUSES.includes(session.status)) {
      throw new ConflictException({
        code: 'LIVE_NOT_JOINABLE',
        message: 'La transmisión terminó.',
      });
    }
  }

  /**
   * Frena el guión que manda mil ofertas, sin frenar a dos personas
   * disputando. Ver `@vivo/domain/services/bid-limits`.
   */
  private async assertWithinRate(buyerId: UserId): Promise<void> {
    const key = `bid-rate:${String(buyerId)}`;
    const now = this.clock.now().getTime();
    const bucket = (await this.cache.get<BidBucket>(key)) ?? newBidBucket(now);
    const allowance = consumeBidToken(bucket, now);

    await this.cache.set(key, allowance.bucket, 600);
    if (!allowance.allowed) throw bidRateLimitError(allowance.retryAfterSeconds);
  }

  /**
   * Emite un evento sin que su fallo pueda deshacer lo que ya se guardó.
   *
   * Una oferta registrada es un hecho; que la sala se haya enterado es una
   * cortesía. Invertir esa prioridad haría que un socket caído rechazara
   * ofertas válidas.
   */
  private async announce(session: BidSession, emit: () => Promise<void> | void): Promise<void> {
    try {
      await emit();
    } catch (error) {
      this.logger.warn(`Evento de puja no entregado (${session.id}): ${String(error)}`);
    }
  }
}

/** Reexportado para los controladores. */
export type { Store };
