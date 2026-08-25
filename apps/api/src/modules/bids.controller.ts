import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { asBidId, asBidSessionId, asLiveSessionId } from '@vivo/domain';
import {
  acceptBidRequestSchema,
  openBidSessionRequestSchema,
  submitBidRequestSchema,
  type AcceptBidRequest,
  type BidSessionDto,
  type OpenBidSessionRequest,
  type SubmitBidRequest,
} from '@vivo/shared';
import { BidService } from '../application/services/bid.service';
import { BidViewService } from '../application/services/bid-view.service';
import { OptionalAuth, Public, requireUser, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

/**
 * Modo Puja, lado comprador.
 *
 * Mirar una puja es público; ofertar exige sesión. Es la misma regla que rige
 * el vivo entero —no se pone un login delante de un video— y acá además hay un
 * motivo concreto: una oferta anónima no se puede honrar. Si el vendedor la
 * acepta, tiene que haber alguien a quien reservarle el producto.
 *
 * **Las ofertas entran por HTTP, no por el socket.** El socket es de salida:
 * reparte lo que ya ocurrió. Aceptar una oferta que llega por WebSocket sería
 * confiar en un canal que no pasa por validación ni por transacción.
 */
@Controller('bids')
export class BidsController {
  constructor(
    private readonly bids: BidService,
    private readonly view: BidViewService,
  ) {}

  /** Las pujas de un vivo. Público: se ven sin cuenta, como el vivo. */
  @Public()
  @OptionalAuth()
  @Get()
  async listForLive(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query('liveSessionId') liveSessionId: string,
  ): Promise<BidSessionDto[]> {
    return this.view.forLive(asLiveSessionId(liveSessionId), user?.id ?? null);
  }

  @Public()
  @OptionalAuth()
  @Get(':id')
  async detail(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<BidSessionDto> {
    return this.view.detail(asBidSessionId(id), user?.id ?? null);
  }

  /**
   * Ofertar. Exige sesión iniciada.
   *
   * El cuerpo lleva un monto y nada más: quién oferta sale del token, y contra
   * qué puja sale de la URL. Nada de lo que decide el resultado viene del
   * navegador.
   */
  @Post(':id/offers')
  async submit(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(submitBidRequestSchema)) body: SubmitBidRequest,
  ): Promise<BidSessionDto> {
    const buyerId = requireUser(user).id;
    await this.bids.submit(buyerId, asBidSessionId(id), body);
    return this.view.detail(asBidSessionId(id), buyerId);
  }
}

/** Modo Puja, lado vendedor. Todo exige sesión y ser dueño de la puja. */
@Controller('seller/bids')
export class SellerBidsController {
  constructor(
    private readonly bids: BidService,
    private readonly view: BidViewService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthenticatedUser | null): Promise<BidSessionDto[]> {
    return this.view.forSeller(requireUser(user).id);
  }

  /** Pone un producto en puja durante el vivo. */
  @Post()
  async open(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(openBidSessionRequestSchema)) body: OpenBidSessionRequest,
  ): Promise<BidSessionDto> {
    const session = await this.bids.open(requireUser(user).id, body);
    return this.view.detail(session.id, requireUser(user).id);
  }

  /**
   * Acepta una oferta. Un solo ganador, siempre.
   *
   * La atomicidad vive en el servicio; acá solo se traduce a HTTP. Dos taps
   * sobre el mismo botón devuelven lo mismo en vez de dos ganadores.
   */
  @Post(':id/accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
    @Body(zodPipe(acceptBidRequestSchema)) body: AcceptBidRequest,
  ): Promise<BidSessionDto> {
    const sellerId = requireUser(user).id;
    await this.bids.accept(sellerId, asBidSessionId(id), asBidId(body.bidId));
    return this.view.detail(asBidSessionId(id), sellerId);
  }

  /** Cierra sin vender. Es una decisión legítima, no un fallo. */
  @Post(':id/close')
  async close(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<BidSessionDto> {
    const sellerId = requireUser(user).id;
    await this.bids.close(sellerId, asBidSessionId(id));
    return this.view.detail(asBidSessionId(id), sellerId);
  }

  /**
   * Reabre una puja cuyo ganador no pagó.
   *
   * Las demás ofertas siguen vivas, así que "ofrecerle al segundo" es reabrir
   * y aceptar la que sigue. No hay un endpoint aparte para eso a propósito:
   * sería el mismo camino con otro nombre, y cobrarle al segundo sin que el
   * vendedor decida es justamente lo que no queremos.
   */
  @Post(':id/reopen')
  async reopen(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('id') id: string,
  ): Promise<BidSessionDto> {
    const sellerId = requireUser(user).id;
    await this.bids.reopen(sellerId, asBidSessionId(id));
    return this.view.detail(asBidSessionId(id), sellerId);
  }
}
