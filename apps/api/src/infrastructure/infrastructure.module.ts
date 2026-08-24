import { Global, Module, type Provider } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type AppEnv } from '../config/env';
import {
  CACHE_STORE,
  NOTIFICATION_PROVIDER,
  PRESENCE_STORE,
  SHIPPING_PROVIDER,
  STORAGE_PROVIDER,
  STREAMING_PROVIDER,
} from '../application/ports/tokens';
import { PAYMENT_PROVIDER_PORT } from '../application/ports/payments';
import { MemoryCacheStore } from './cache/memory-cache';
import { MemoryPresenceStore } from './cache/memory-presence';
import {
  REDIS_CLIENT,
  RedisCacheStore,
  RedisPresenceStore,
  createRedisClient,
} from './cache/redis-cache';
import { LiveKitStreamingProvider } from './providers/livekit.provider';
import { FakePaymentProvider } from './providers/fake-payment.provider';
import { MercadoPagoProvider } from './providers/mercadopago.provider';
import {
  FlatRateShippingProvider,
  LocalStorageProvider,
  LogNotificationProvider,
  MockStreamingProvider,
} from './providers/simulated.providers';
import { PersistenceModule } from './persistence/persistence.module';

/**
 * Every replaceable seam is bound here and nowhere else.
 *
 * Reading this file tells you, in one screen, which concrete implementation
 * backs each port for the current configuration. Integrating Mercado Pago, or
 * moving presence to Redis, is an edit to one of these lists — never a change
 * to a use case.
 */
const cacheProviders: Provider[] = [
  {
    provide: REDIS_CLIENT,
    inject: [ENV],
    useFactory: (env: AppEnv) => (env.CACHE_DRIVER === 'redis' ? createRedisClient(env) : null),
  },
  MemoryCacheStore,
  MemoryPresenceStore,
  {
    provide: CACHE_STORE,
    inject: [ENV, MemoryCacheStore, REDIS_CLIENT],
    useFactory: (env: AppEnv, memory: MemoryCacheStore, redis: Redis | null) =>
      env.CACHE_DRIVER === 'redis' && redis ? new RedisCacheStore(redis) : memory,
  },
  {
    provide: PRESENCE_STORE,
    inject: [ENV, MemoryPresenceStore, REDIS_CLIENT],
    useFactory: (env: AppEnv, memory: MemoryPresenceStore, redis: Redis | null) =>
      env.CACHE_DRIVER === 'redis' && redis ? new RedisPresenceStore(redis) : memory,
  },
];

const externalProviders: Provider[] = [
  FakePaymentProvider,
  {
    /**
     * Elegido por configuracion, no por build.
     *
     * `fake` es el default para que un clon del repositorio arranque sin que
     * nadie entregue credenciales; `mercadopago` exige las tres, y `env.ts` lo
     * valida al arrancar en vez de dejar que falle el primer cobro.
     */
    provide: PAYMENT_PROVIDER_PORT,
    inject: [ENV, FakePaymentProvider],
    useFactory: (env: AppEnv, fake: FakePaymentProvider) =>
      env.PAYMENT_PROVIDER === 'mercadopago' ? new MercadoPagoProvider(env) : fake,
  },
  MockStreamingProvider,
  {
    // Chosen by configuration, not by build. `mock` is the default so a fresh
    // clone runs with no LiveKit account and no Docker; `livekit` requires the
    // three credentials, which `env.ts` validates at boot rather than letting
    // the first broadcast fail.
    provide: STREAMING_PROVIDER,
    inject: [ENV, MockStreamingProvider],
    useFactory: (env: AppEnv, mock: MockStreamingProvider) =>
      env.STREAMING_PROVIDER === 'livekit' ? new LiveKitStreamingProvider(env) : mock,
  },
  { provide: NOTIFICATION_PROVIDER, useClass: LogNotificationProvider },
  { provide: SHIPPING_PROVIDER, useClass: FlatRateShippingProvider },
  { provide: STORAGE_PROVIDER, useClass: LocalStorageProvider },
];

/** Resolved once so `imports` and `exports` reference the same instance. */
const persistence = PersistenceModule.register();

@Global()
@Module({
  imports: [persistence],
  providers: [...cacheProviders, ...externalProviders],
  exports: [
    CACHE_STORE,
    PRESENCE_STORE,
    PAYMENT_PROVIDER_PORT,
    FakePaymentProvider,
    STREAMING_PROVIDER,
    NOTIFICATION_PROVIDER,
    SHIPPING_PROVIDER,
    STORAGE_PROVIDER,
    persistence,
  ],
})
export class InfrastructureModule {}
