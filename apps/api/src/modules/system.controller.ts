import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { listMarkets } from '@vivo/config';
import {
  analyticsEventRequestSchema,
  type AnalyticsEventRequest,
} from '@vivo/shared';
import { AnalyticsService } from '../application/services/analytics.service';
import { ENV, type AppEnv } from '../config/env';
import { OptionalAuth, Public, type AuthenticatedUser } from '../common/auth.guard';
import { CurrentUser, zodPipe } from '../common/http';

@Controller()
export class SystemController {
  constructor(
    private readonly analytics: AnalyticsService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  /**
   * Estado del proceso.
   *
   * `version` son los 7 caracteres del commit desplegado. Lo que se publica
   * acá es deliberadamente poco —qué drivers están activos, hace cuánto
   * arrancó y qué commit es— porque es un endpoint público: alcanza para
   * diagnosticar un deploy y no describe la infraestructura.
   */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      version: this.env.version,
      dataDriver: this.env.DATA_DRIVER,
      cacheDriver: this.env.CACHE_DRIVER,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /** Lets the web app render currency, address and delivery options per market. */
  @Public()
  @Get('markets')
  markets() {
    return listMarkets().map((market) => ({
      country: market.country,
      name: market.name,
      locale: market.locale,
      currency: market.currency,
      status: market.status,
      tax: market.tax,
      delivery: market.delivery,
      payment: market.payment,
      address: {
        regionLabel: market.address.regionLabel,
        localityLabel: market.address.localityLabel,
        postalCodeRequired: market.address.postalCodeRequired,
        regions: market.address.regions,
      },
    }));
  }

  /**
   * Analytics ingestion. Accepts events from signed-out visitors too, because
   * the most interesting part of the funnel happens before sign-up.
   */
  @OptionalAuth()
  @HttpCode(204)
  @Post('analytics/events')
  async track(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body(zodPipe(analyticsEventRequestSchema)) body: AnalyticsEventRequest,
  ): Promise<void> {
    await this.analytics.record(body, user?.id ?? null);
  }
}
