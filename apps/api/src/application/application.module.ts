import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../infrastructure/realtime/realtime.module';
import { AdminService } from './services/admin.service';
import { ModerationService } from './services/moderation.service';
import { AnalyticsService } from './services/analytics.service';
import { BidService } from './services/bid.service';
import { BidViewService } from './services/bid-view.service';
import { AuthService } from './services/auth.service';
import { CatalogService } from './services/catalog.service';
import { CheckoutService } from './services/checkout.service';
import { LiveService } from './services/live.service';
import { MediaService } from './services/media.service';
import { NotificationService } from './services/notification.service';
import { OrderService } from './services/order.service';
import { PaymentService } from './services/payment.service';
import { ProtectionService } from './services/protection.service';
import { VerificationService } from './services/verification.service';
import { SellerService } from './services/seller.service';
import { StoreService } from './services/store.service';
import { SocialAuthService } from './services/social-auth.service';
import { AccountService } from './services/account.service';
import { PasswordFlowService } from './services/password.service';

const SERVICES = [
  NotificationService,
  MediaService,
  AuthService,
  SocialAuthService,
  PasswordFlowService,
  AccountService,
  StoreService,
  CatalogService,
  LiveService,
  CheckoutService,
  OrderService,
  SellerService,
  AnalyticsService,
  PaymentService,
  VerificationService,
  ProtectionService,
  BidService,
  BidViewService,
  AdminService,
  ModerationService,
];

/**
 * The use-case layer.
 *
 * Split out of `AppModule` so the realtime gateway can depend on it without
 * dragging in every controller. The `forwardRef` pair with `RealtimeModule` is
 * a genuine two-way dependency — services publish events, the gateway asks
 * services to validate joins — and it is small and explicit. The alternative,
 * an event bus with exactly one subscriber, would be more machinery for less
 * clarity.
 */
@Module({
  imports: [forwardRef(() => RealtimeModule)],
  providers: SERVICES,
  exports: SERVICES,
})
export class ApplicationModule {}
