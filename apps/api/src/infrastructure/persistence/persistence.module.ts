import {
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Provider,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { ENV, loadEnv, type AppEnv } from '../../config/env';
import {
  ANALYTICS_REPOSITORY,
  FOLLOW_REPOSITORY,
  PUSH_SUBSCRIPTION_REPOSITORY,
  PUSH_DELIVERY_REPOSITORY,
  LIVE_REPOSITORY,
  MESSAGE_REPOSITORY,
  ORDER_REPOSITORY,
  ORDER_TRANSACTION_RUNNER,
  PRODUCT_REPOSITORY,
  STORE_REPOSITORY,
  USER_REPOSITORY,
  USER_IDENTITY_REPOSITORY,
  LOGIN_STATE_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  ACCOUNT_DELETION_REPOSITORY,
} from '../../application/ports/tokens';
import { BID_REPOSITORY, BID_TRANSACTION_RUNNER } from '../../application/ports/bids';
import {
  DISPUTE_REPOSITORY,
  OAUTH_STATE_REPOSITORY,
  PAYMENT_REPOSITORY,
  PAYMENT_TRANSACTION_RUNNER,
  SELLER_PAYMENT_ACCOUNT_REPOSITORY,
  VERIFICATION_REPOSITORY,
} from '../../application/ports/payments';
import { PasswordService } from '../security/password.service';
import { DRIZZLE, createDatabase } from './drizzle/client';
import { DrizzleOrderTransactionRunner } from './drizzle/drizzle.order-transaction';
import { DrizzleBidRepository, DrizzleBidTransactionRunner } from './drizzle/drizzle.bids';
import { MemoryBidRepository, MemoryBidTransactionRunner } from './memory/memory.bids';
import {
  DrizzleDisputeRepository,
  DrizzleOAuthStateRepository,
  DrizzlePaymentRepository,
  DrizzlePaymentTransactionRunner,
  DrizzleSellerPaymentAccountRepository,
  DrizzleVerificationRepository,
} from './drizzle/drizzle.payments';
import {
  MemoryDisputeRepository,
  MemoryOAuthStateRepository,
  MemoryPaymentRepository,
  MemoryPaymentTransactionRunner,
  MemorySellerPaymentAccountRepository,
  MemoryVerificationRepository,
} from './memory/memory.payments';
import {
  DrizzleAnalyticsRepository,
  DrizzleFollowRepository,
  DrizzlePushSubscriptionRepository,
  DrizzlePushDeliveryRepository,
  DrizzleLiveRepository,
  DrizzleMessageRepository,
  DrizzleOrderRepository,
  DrizzleProductRepository,
  DrizzleStoreRepository,
  DrizzleUserRepository,
  DrizzleUserIdentityRepository,
  DrizzleLoginStateRepository,
  DrizzlePasswordResetRepository,
  DrizzleAccountDeletionRepository,
} from './drizzle/drizzle.repositories';
import { AesGcmSecretBox, SECRET_BOX, loadEncryptionKeys } from '../crypto/secret-box';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryOrderTransactionRunner } from './memory/memory.order-transaction';
import {
  MemoryAnalyticsRepository,
  MemoryFollowRepository,
  MemoryPushSubscriptionRepository,
  MemoryPushDeliveryRepository,
  MemoryLiveRepository,
  MemoryMessageRepository,
  MemoryOrderRepository,
  MemoryProductRepository,
  MemoryStoreRepository,
  MemoryUserRepository,
  MemoryUserIdentityRepository,
  MemoryLoginStateRepository,
  MemoryPasswordResetRepository,
  MemoryAccountDeletionRepository,
} from './memory/memory.repositories';

const REPOSITORY_TOKENS = [
  USER_REPOSITORY,
  ACCOUNT_DELETION_REPOSITORY,
  USER_IDENTITY_REPOSITORY,
  LOGIN_STATE_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  PUSH_SUBSCRIPTION_REPOSITORY,
  PUSH_DELIVERY_REPOSITORY,
  STORE_REPOSITORY,
  PRODUCT_REPOSITORY,
  LIVE_REPOSITORY,
  MESSAGE_REPOSITORY,
  ORDER_REPOSITORY,
  FOLLOW_REPOSITORY,
  ANALYTICS_REPOSITORY,
  ORDER_TRANSACTION_RUNNER,
  PAYMENT_REPOSITORY,
  SELLER_PAYMENT_ACCOUNT_REPOSITORY,
  OAUTH_STATE_REPOSITORY,
  DISPUTE_REPOSITORY,
  VERIFICATION_REPOSITORY,
  PAYMENT_TRANSACTION_RUNNER,
  BID_REPOSITORY,
  BID_TRANSACTION_RUNNER,
];

const POOL = Symbol('PgPool');

/**
 * The in-memory driver.
 *
 * Default, and the reason `pnpm dev` needs no Docker, no database and no
 * migration step. It loads the demo dataset on boot, which is also what makes
 * the app look like a real product the first time it is opened.
 */
@Module({
  providers: [
    MemoryDatabase,
    { provide: USER_REPOSITORY, useClass: MemoryUserRepository },
    { provide: USER_IDENTITY_REPOSITORY, useClass: MemoryUserIdentityRepository },
    { provide: LOGIN_STATE_REPOSITORY, useClass: MemoryLoginStateRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: MemoryPasswordResetRepository },
    { provide: ACCOUNT_DELETION_REPOSITORY, useClass: MemoryAccountDeletionRepository },
    { provide: STORE_REPOSITORY, useClass: MemoryStoreRepository },
    { provide: PRODUCT_REPOSITORY, useClass: MemoryProductRepository },
    { provide: LIVE_REPOSITORY, useClass: MemoryLiveRepository },
    { provide: MESSAGE_REPOSITORY, useClass: MemoryMessageRepository },
    { provide: ORDER_REPOSITORY, useClass: MemoryOrderRepository },
    { provide: FOLLOW_REPOSITORY, useClass: MemoryFollowRepository },
    { provide: PUSH_SUBSCRIPTION_REPOSITORY, useClass: MemoryPushSubscriptionRepository },
    { provide: PUSH_DELIVERY_REPOSITORY, useClass: MemoryPushDeliveryRepository },
    { provide: ANALYTICS_REPOSITORY, useClass: MemoryAnalyticsRepository },
    { provide: ORDER_TRANSACTION_RUNNER, useClass: MemoryOrderTransactionRunner },
    { provide: PAYMENT_REPOSITORY, useClass: MemoryPaymentRepository },
    {
      provide: SELLER_PAYMENT_ACCOUNT_REPOSITORY,
      useClass: MemorySellerPaymentAccountRepository,
    },
    { provide: OAUTH_STATE_REPOSITORY, useClass: MemoryOAuthStateRepository },
    { provide: DISPUTE_REPOSITORY, useClass: MemoryDisputeRepository },
    { provide: VERIFICATION_REPOSITORY, useClass: MemoryVerificationRepository },
    { provide: PAYMENT_TRANSACTION_RUNNER, useClass: MemoryPaymentTransactionRunner },
    { provide: BID_REPOSITORY, useClass: MemoryBidRepository },
    { provide: BID_TRANSACTION_RUNNER, useClass: MemoryBidTransactionRunner },
  ],
  exports: [...REPOSITORY_TOKENS, MemoryDatabase],
})
export class MemoryPersistenceModule implements OnModuleInit {
  private readonly logger = new Logger('Persistence');

  constructor(
    private readonly db: MemoryDatabase,
    private readonly passwords: PasswordService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.db.seed((plain) => this.passwords.hash(plain));
    this.logger.log(
      `Driver memory: ${this.db.stores.size} tiendas, ${this.db.products.size} productos, ` +
        `${this.db.liveSessions.size} transmisiones.`,
    );
  }
}

/**
 * The PostgreSQL driver.
 *
 * Seeding is explicit here (`pnpm db:seed`) rather than automatic: silently
 * overwriting a real database on every restart would be hostile.
 */
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ENV],
      useFactory: (env: AppEnv) =>
        createDatabase(env.DATABASE_URL as string, {
          mode: env.DATABASE_SSL,
          caCert: env.DATABASE_CA_CERT,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [POOL],
      useFactory: (created: { db: unknown }) => created.db,
    },
    /**
     * El cifrado de credenciales vive solo en el driver de postgres.
     *
     * No es un descuido: "en reposo" quiere decir escrito en un disco que
     * alguien puede copiar. El driver en memoria no escribe nada —muere con el
     * proceso— así que cifrarlo no protegería de nada y solo agregaría una
     * pieza donde no hace falta.
     */
    {
      provide: SECRET_BOX,
      inject: [ENV],
      useFactory: (env: AppEnv) =>
        new AesGcmSecretBox(
          loadEncryptionKeys({
            ...(env.ENCRYPTION_KEY ? { ENCRYPTION_KEY: env.ENCRYPTION_KEY } : {}),
            ...(env.ENCRYPTION_KEY_PREVIOUS
              ? { ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY_PREVIOUS }
              : {}),
            isProduction: env.isProduction,
          }),
        ),
    },
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: USER_IDENTITY_REPOSITORY, useClass: DrizzleUserIdentityRepository },
    { provide: LOGIN_STATE_REPOSITORY, useClass: DrizzleLoginStateRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: DrizzlePasswordResetRepository },
    { provide: ACCOUNT_DELETION_REPOSITORY, useClass: DrizzleAccountDeletionRepository },
    { provide: STORE_REPOSITORY, useClass: DrizzleStoreRepository },
    { provide: PRODUCT_REPOSITORY, useClass: DrizzleProductRepository },
    { provide: LIVE_REPOSITORY, useClass: DrizzleLiveRepository },
    { provide: MESSAGE_REPOSITORY, useClass: DrizzleMessageRepository },
    { provide: ORDER_REPOSITORY, useClass: DrizzleOrderRepository },
    { provide: FOLLOW_REPOSITORY, useClass: DrizzleFollowRepository },
    { provide: PUSH_SUBSCRIPTION_REPOSITORY, useClass: DrizzlePushSubscriptionRepository },
    { provide: PUSH_DELIVERY_REPOSITORY, useClass: DrizzlePushDeliveryRepository },
    { provide: ANALYTICS_REPOSITORY, useClass: DrizzleAnalyticsRepository },
    { provide: ORDER_TRANSACTION_RUNNER, useClass: DrizzleOrderTransactionRunner },
    { provide: PAYMENT_REPOSITORY, useClass: DrizzlePaymentRepository },
    {
      provide: SELLER_PAYMENT_ACCOUNT_REPOSITORY,
      useClass: DrizzleSellerPaymentAccountRepository,
    },
    { provide: OAUTH_STATE_REPOSITORY, useClass: DrizzleOAuthStateRepository },
    { provide: DISPUTE_REPOSITORY, useClass: DrizzleDisputeRepository },
    { provide: VERIFICATION_REPOSITORY, useClass: DrizzleVerificationRepository },
    { provide: PAYMENT_TRANSACTION_RUNNER, useClass: DrizzlePaymentTransactionRunner },
    { provide: BID_REPOSITORY, useClass: DrizzleBidRepository },
    { provide: BID_TRANSACTION_RUNNER, useClass: DrizzleBidTransactionRunner },
  ],
  exports: [...REPOSITORY_TOKENS, DRIZZLE],
})
export class PostgresPersistenceModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Persistence');

  constructor(@Inject(POOL) private readonly created: { pool: Pool }) {}

  async onModuleInit(): Promise<void> {
    // Fail loudly at boot rather than on the first buyer request.
    await this.created.pool.query('select 1');
    this.logger.log('Driver postgres: conexión verificada.');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.created.pool.end().catch(() => undefined);
  }
}

/**
 * Selects the driver from `DATA_DRIVER`. Nothing above this module — no
 * service, no controller — can tell which one is active.
 */
@Module({})
export class PersistenceModule {
  static register(): DynamicModule {
    const env = loadEnv();
    const driver = env.DATA_DRIVER === 'postgres' ? PostgresPersistenceModule : MemoryPersistenceModule;

    return {
      module: PersistenceModule,
      imports: [driver],
      exports: [driver],
    };
  }
}

/** Exposed for tests that need to build a provider list directly. */
export const persistenceTokens: readonly symbol[] = REPOSITORY_TOKENS;
export type PersistenceProvider = Provider;
