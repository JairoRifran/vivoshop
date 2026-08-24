import { Global, Injectable, Logger, Module, forwardRef } from '@nestjs/common';
import {
  REALTIME_EVENTS,
  type ChatMessagePayload,
  type LiveSessionId,
  type LiveStatePayload,
  type OrderCreatedPayload,
  type ProductFeaturedPayload,
  type ReactionBurstPayload,
  type SaleAnnouncedPayload,
  type StoreId,
  type ViewerCountPayload,
} from '@vivo/domain';
import type { RealtimePublisher } from '../../application/ports/realtime';
import { REALTIME_PUBLISHER } from '../../application/ports/tokens';
import { ApplicationModule } from '../../application/application.module';
import { LiveJanitor } from './live-janitor';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Publishes business events through the gateway.
 *
 * The indirection earns its place twice: `LiveService` never imports
 * Socket.IO, and every emit is wrapped so a transport failure cannot fail the
 * operation that already succeeded. A seller's console missing a "nueva venta"
 * frame is a cosmetic problem; an order rolling back because a socket was
 * closed would be a real one.
 */
@Injectable()
export class GatewayRealtimePublisher implements RealtimePublisher {
  private readonly logger = new Logger('RealtimePublisher');

  constructor(private readonly gateway: RealtimeGateway) {}

  async liveStateChanged(payload: LiveStatePayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.liveState, payload);
  }

  async featuredProductChanged(payload: ProductFeaturedPayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.productFeatured, payload);
  }

  async chatMessagePosted(payload: ChatMessagePayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.chatMessage, payload);
  }

  async reactionBurst(payload: ReactionBurstPayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.reactionBurst, payload);
  }

  async viewerCountChanged(payload: ViewerCountPayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.viewerCount, payload);
  }

  /** Seller room only: this payload carries revenue. */
  async orderCreated(_storeId: StoreId, payload: OrderCreatedPayload): Promise<void> {
    try {
      this.gateway.emitToSeller(payload.liveSessionId, REALTIME_EVENTS.orderCreated, payload);
    } catch (error) {
      this.logger.warn(`order.created not delivered: ${String(error)}`);
    }
  }

  async saleAnnounced(payload: SaleAnnouncedPayload): Promise<void> {
    this.safeEmit(payload.liveSessionId, REALTIME_EVENTS.saleAnnounced, payload);
  }

  async roomSize(liveSessionId: LiveSessionId): Promise<number> {
    try {
      return await this.gateway.roomSize(liveSessionId);
    } catch {
      return 0;
    }
  }

  private safeEmit(sessionId: string, event: string, payload: unknown): void {
    try {
      this.gateway.emitToLive(sessionId, event, payload);
    } catch (error) {
      this.logger.warn(`${event} not delivered: ${String(error)}`);
    }
  }
}

/**
 * No-op publisher.
 *
 * Used when the gateway is not running — unit tests, scripts, the smoke test.
 * Every call succeeds and does nothing, which is exactly what "nobody is
 * listening" should mean.
 */
@Injectable()
export class NoopRealtimePublisher implements RealtimePublisher {
  async liveStateChanged(): Promise<void> {}
  async featuredProductChanged(): Promise<void> {}
  async chatMessagePosted(): Promise<void> {}
  async reactionBurst(): Promise<void> {}
  async viewerCountChanged(): Promise<void> {}
  async orderCreated(): Promise<void> {}
  async saleAnnounced(): Promise<void> {}
  async roomSize(): Promise<number> {
    return 0;
  }
}

/**
 * `forwardRef` because the gateway needs `LiveService` to validate joins and
 * `LiveService` needs the publisher to fan out. The cycle is real and small;
 * breaking it would mean an event bus whose only subscriber is this class.
 */
@Global()
@Module({
  imports: [forwardRef(() => ApplicationModule)],
  providers: [
    RealtimeGateway,
    LiveJanitor,
    { provide: REALTIME_PUBLISHER, useClass: GatewayRealtimePublisher },
  ],
  exports: [REALTIME_PUBLISHER, RealtimeGateway, LiveJanitor],
})
export class RealtimeModule {}
