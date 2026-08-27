import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApplicationModule } from './application/application.module';
import { JwtAuthGuard } from './common/auth.guard';
import { ApiExceptionFilter } from './common/http';
import { ENV, loadEnv, type AppEnv } from './config/env';
import { CoreModule } from './core.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { AuthController } from './modules/auth.controller';
import { ProductsController, StoresController } from './modules/catalog.controller';
import { LiveController } from './modules/live.controller';
import { MediaController } from './modules/media.controller';
import { BidsController, SellerBidsController } from './modules/bids.controller';
import { CheckoutController, OrdersController } from './modules/orders.controller';
import {
  PaymentsController,
  SellerPaymentsController,
  VerificationController,
} from './modules/payments.controller';
import { SellerController } from './modules/seller.controller';
import { NotificationsController } from './modules/notifications.controller';
import { SystemController } from './modules/system.controller';
import { TestingModule } from './modules/testing.controller';

/**
 * A modular monolith: one deployable, clear internal seams.
 *
 *   modules/         HTTP surface — parsing, status codes, nothing else
 *   application/     use cases and ports
 *   @vivo/domain     rules and invariants, framework free
 *   infrastructure/  the only place that knows about Postgres, Redis or a vendor
 *
 * Dependencies point inward. `application` may import `domain`; `domain`
 * imports neither of the others, and ESLint enforces that.
 */
@Module({
  imports: [
    CoreModule,
    InfrastructureModule,
    RealtimeModule,
    ApplicationModule,
    TestingModule.register(loadEnv()),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: AppEnv) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT }],
      }),
    }),
  ],
  controllers: [
    SystemController,
    NotificationsController,
    AuthController,
    StoresController,
    ProductsController,
    LiveController,
    MediaController,
    CheckoutController,
    OrdersController,
    SellerController,
    PaymentsController,
    SellerPaymentsController,
    VerificationController,
    BidsController,
    SellerBidsController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Order matters: rate limiting runs before authentication so an
    // unauthenticated flood is rejected without touching the datastore.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {
  static env(): AppEnv {
    return loadEnv();
  }
}
