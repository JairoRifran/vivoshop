import { Inject, Injectable } from '@nestjs/common';
import type { Bid, BidOutcome, BidSession, BidSessionId, LiveSessionId, UserId } from '@vivo/domain';
import {
  leadingBid,
  nextMinimumBid,
  reservationSecondsLeft,
  withOutcomes,
} from '@vivo/domain';
import type { BidSessionDto, ProductSummaryDto } from '@vivo/shared';
import { toProductSummaryDto } from '../mappers/dto.mappers';
import type { BidRepository } from '../ports/bids';
import { BID_REPOSITORY } from '../ports/bids';
import type { Clock } from '../ports/infrastructure';
import type { ProductRepository, StoreRepository } from '../ports/repositories';
import { CLOCK, PRODUCT_REPOSITORY, STORE_REPOSITORY } from '../ports/tokens';

/**
 * Arma lo que la pantalla necesita para una puja.
 *
 * Vive aparte de `BidService` porque son dos trabajos distintos: aquel decide
 * y escribe, este lee y compone. Mezclarlos haría que cada acción tuviera que
 * cargar productos y tiendas solo para poder responder, y que leer una puja
 * arrastrara la maquinaria de escribirla.
 *
 * Lo que sale de acá es público salvo dos campos: `viewerBid` y `checkoutUrl`
 * solo aparecen para quien corresponde.
 */
@Injectable()
export class BidViewService {
  constructor(
    @Inject(BID_REPOSITORY) private readonly bids: BidRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async forLive(liveSessionId: LiveSessionId, viewerId: UserId | null): Promise<BidSessionDto[]> {
    const sessions = await this.bids.listSessionsForLive(liveSessionId);
    return this.composeMany(sessions, viewerId);
  }

  async forSeller(sellerId: UserId): Promise<BidSessionDto[]> {
    const store = await this.stores.findByOwner(sellerId);
    if (!store) return [];
    const sessions = await this.bids.listSessionsForStore(store.id);
    return this.composeMany(sessions, sellerId);
  }

  async detail(id: BidSessionId, viewerId: UserId | null): Promise<BidSessionDto> {
    const session = await this.bids.findSession(id);
    if (!session) {
      throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
    }
    const [dto] = await this.composeMany([session], viewerId);
    return dto as BidSessionDto;
  }

  /**
   * Compone varias sesiones cargando productos y tiendas **una sola vez**.
   *
   * Un vivo puede tener varias pujas y la pantalla las pide juntas; resolver el
   * producto dentro del map sería una consulta por puja, que es exactamente el
   * N+1 que los mappers de este proyecto evitan recibiendo todo por argumento.
   */
  private async composeMany(
    sessions: readonly BidSession[],
    viewerId: UserId | null,
  ): Promise<BidSessionDto[]> {
    if (sessions.length === 0) return [];

    const [products, stores, bidsBySession] = await Promise.all([
      this.products.listByIds(sessions.map((session) => session.productId)),
      this.stores.listByIds(sessions.map((session) => session.storeId)),
      Promise.all(sessions.map((session) => this.bids.listBids(session.id))),
    ]);

    const productById = new Map(products.map((product) => [String(product.id), product]));
    const storeById = new Map(stores.map((store) => [String(store.id), store]));
    const now = this.clock.now();

    return sessions.flatMap((session, index) => {
      const product = productById.get(String(session.productId));
      const store = storeById.get(String(session.storeId));
      /* c8 ignore next -- la sesión no existe sin producto ni tienda. */
      if (!product || !store) return [];

      return [
        this.compose({
          session,
          product: toProductSummaryDto(product, store),
          bids: bidsBySession[index] ?? [],
          viewerId,
          now,
        }),
      ];
    });
  }

  private compose(input: {
    session: BidSession;
    product: ProductSummaryDto;
    bids: readonly Bid[];
    viewerId: UserId | null;
    now: Date;
  }): BidSessionDto {
    const { session, bids, viewerId, now } = input;
    const outcomes = withOutcomes(bids, session);
    const leader = leadingBid(bids);

    const viewerOwn = viewerId
      ? (outcomes.find((entry) => entry.bid.buyerId === viewerId) ?? null)
      : null;

    return {
      id: String(session.id),
      liveSessionId: String(session.liveSessionId),
      status: session.status,
      product: input.product,
      variantId: String(session.variantId),
      currency: session.currency,
      referencePriceMinor: session.referencePriceMinor,
      minimumBidMinor: session.minimumBidMinor,
      minimumIncrementMinor: session.minimumIncrementMinor,
      leadingBid: leader ? toBidDto(leader, outcomes) : null,
      // Calculado por el servidor con la misma función que valida la oferta,
      // para que el "mínimo siguiente" que se muestra no pueda diferir del que
      // la va a rechazar.
      nextMinimumMinor: nextMinimumBid(session, leader),
      bids: outcomes.map((entry) => toBidDto(entry.bid, outcomes)),
      reservationSecondsLeft:
        session.status === 'reserved' ? reservationSecondsLeft(session, now) : 0,
      ...(viewerOwn ? { viewerBid: toBidDto(viewerOwn.bid, outcomes) } : {}),
      openedAt: session.openedAt.toISOString(),
    };
  }
}

/** Nombre público y monto. Ningún id de usuario sale de acá. */
function toBidDto(
  bid: Bid,
  outcomes: ReadonlyArray<{ bid: Bid; outcome: BidOutcome }>,
): BidSessionDto['bids'][number] {
  return {
    id: String(bid.id),
    bidderName: bid.buyerName,
    bidderAvatarUrl: bid.buyerAvatarUrl,
    amountMinor: bid.amountMinor,
    currency: bid.currency,
    outcome: outcomes.find((entry) => entry.bid.id === bid.id)?.outcome ?? 'leading',
    createdAt: bid.createdAt.toISOString(),
  };
}
