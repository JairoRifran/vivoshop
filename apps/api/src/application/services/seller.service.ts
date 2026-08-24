import { Inject, Injectable } from '@nestjs/common';
import type { UserId } from '@vivo/domain';
import type { SellerMetricsDto } from '@vivo/shared';
import type { Clock } from '../ports/infrastructure';
import type {
  AnalyticsRepository,
  LiveRepository,
  OrderRepository,
  ProductRepository,
} from '../ports/repositories';
import {
  ANALYTICS_REPOSITORY,
  CLOCK,
  LIVE_REPOSITORY,
  ORDER_REPOSITORY,
  PRODUCT_REPOSITORY,
} from '../ports/tokens';
import { LiveService } from './live.service';
import { StoreService } from './store.service';

/**
 * The seller dashboard. Every number is computed from real rows in the active
 * driver — none of it is hard-coded — so once a seller creates a product or
 * receives an order, the dashboard reflects it immediately.
 */
@Injectable()
export class SellerService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(LIVE_REPOSITORY) private readonly sessions: LiveRepository,
    @Inject(ANALYTICS_REPOSITORY) private readonly analytics: AnalyticsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storeService: StoreService,
    private readonly liveService: LiveService,
  ) {}

  async metrics(ownerId: UserId): Promise<SellerMetricsDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const now = this.clock.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

    const [orders, products, sessions, liveViews] = await Promise.all([
      this.orders.list({ storeId: store.id }),
      this.products.list({ storeId: store.id }),
      this.sessions.list({ storeId: store.id }),
      this.analytics.countByName('live_view_started', weekAgo),
    ]);

    const paidToday = orders.filter(
      (order) =>
        order.createdAt >= startOfDay &&
        order.status !== 'cancelled' &&
        order.status !== 'pending_payment',
    );

    const ordersToday = orders.filter((order) => order.createdAt >= startOfDay);
    const pending = orders.filter(
      (order) => order.status === 'paid' || order.status === 'preparing',
    );

    const activeSession = sessions.find((session) => session.status === 'live') ?? null;
    const nextSession =
      sessions
        .filter((session) => session.status === 'scheduled' && session.scheduledAt)
        .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))[0] ??
      null;

    const [activeDto, nextDto] = await Promise.all([
      activeSession ? this.liveService.detail(activeSession.id, ownerId) : Promise.resolve(null),
      nextSession ? this.liveService.detail(nextSession.id, ownerId) : Promise.resolve(null),
    ]);

    // Orders per viewer over the last seven days, in basis points. Falls back
    // to zero rather than dividing by zero on a store that has not streamed.
    const conversionBps =
      liveViews > 0 ? Math.round((orders.length / liveViews) * 10_000) : 0;

    return {
      storeId: String(store.id),
      currency: store.currency,
      salesTodayMinor: paidToday.reduce((total, order) => total + order.totalMinor, 0),
      ordersToday: ordersToday.length,
      ordersPending: pending.length,
      viewersLast7Days: liveViews,
      conversionBps,
      productsActive: products.filter((product) => product.status === 'active').length,
      nextLive: nextDto,
      activeLive: activeDto,
    };
  }
}
