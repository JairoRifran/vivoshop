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
  LIVE_REPOSITORY,
  MESSAGE_REPOSITORY,
  ORDER_REPOSITORY,
  ORDER_TRANSACTION_RUNNER,
  PRODUCT_REPOSITORY,
  STORE_REPOSITORY,
  USER_REPOSITORY,
} from '../../application/ports/tokens';
import { PasswordService } from '../security/password.service';
import { DRIZZLE, createDatabase } from './drizzle/client';
import { DrizzleOrderTransactionRunner } from './drizzle/drizzle.order-transaction';
import {
  DrizzleAnalyticsRepository,
  DrizzleFollowRepository,
  DrizzleLiveRepository,
  DrizzleMessageRepository,
  DrizzleOrderRepository,
  DrizzleProductRepository,
  DrizzleStoreRepository,
  DrizzleUserRepository,
} from './drizzle/drizzle.repositories';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryOrderTransactionRunner } from './memory/memory.order-transaction';
import {
  MemoryAnalyticsRepository,
  MemoryFollowRepository,
  MemoryLiveRepository,
  MemoryMessageRepository,
  MemoryOrderRepository,
  MemoryProductRepository,
  MemoryStoreRepository,
  MemoryUserRepository,
} from './memory/memory.repositories';

const REPOSITORY_TOKENS = [
  USER_REPOSITORY,
  STORE_REPOSITORY,
  PRODUCT_REPOSITORY,
  LIVE_REPOSITORY,
  MESSAGE_REPOSITORY,
  ORDER_REPOSITORY,
  FOLLOW_REPOSITORY,
  ANALYTICS_REPOSITORY,
  ORDER_TRANSACTION_RUNNER,
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
    { provide: STORE_REPOSITORY, useClass: MemoryStoreRepository },
    { provide: PRODUCT_REPOSITORY, useClass: MemoryProductRepository },
    { provide: LIVE_REPOSITORY, useClass: MemoryLiveRepository },
    { provide: MESSAGE_REPOSITORY, useClass: MemoryMessageRepository },
    { provide: ORDER_REPOSITORY, useClass: MemoryOrderRepository },
    { provide: FOLLOW_REPOSITORY, useClass: MemoryFollowRepository },
    { provide: ANALYTICS_REPOSITORY, useClass: MemoryAnalyticsRepository },
    { provide: ORDER_TRANSACTION_RUNNER, useClass: MemoryOrderTransactionRunner },
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
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: STORE_REPOSITORY, useClass: DrizzleStoreRepository },
    { provide: PRODUCT_REPOSITORY, useClass: DrizzleProductRepository },
    { provide: LIVE_REPOSITORY, useClass: DrizzleLiveRepository },
    { provide: MESSAGE_REPOSITORY, useClass: DrizzleMessageRepository },
    { provide: ORDER_REPOSITORY, useClass: DrizzleOrderRepository },
    { provide: FOLLOW_REPOSITORY, useClass: DrizzleFollowRepository },
    { provide: ANALYTICS_REPOSITORY, useClass: DrizzleAnalyticsRepository },
    { provide: ORDER_TRANSACTION_RUNNER, useClass: DrizzleOrderTransactionRunner },
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
