import type { CurrencyCode } from '@vivo/config';
import type {
  LiveCapabilities,
  LiveSessionId,
  Order,
  OrderId,
  StoreId,
  UserId,
} from '@vivo/domain';

// --- Time and identity ---------------------------------------------------------

/** Injected so use cases stay deterministic under test. */
export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(prefix?: string): string;
}

// --- Cache and presence ---------------------------------------------------------

/**
 * Minimal key/value surface. Backed by a Map today and by Redis when
 * `CACHE_DRIVER=redis`, without any call site changing.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Returns the value after incrementing. Used by rate limits and counters. */
  increment(key: string, by?: number, ttlSeconds?: number): Promise<number>;
}

/**
 * Live viewer presence. Redis sets are the obvious production implementation;
 * the in-memory one is enough for a single API process.
 */
export interface PresenceStore {
  /**
   * `connectionKey` is one socket; `identityKey` is the person behind it.
   * Counting by identity is what stops two tabs from reading as two viewers.
   */
  join(sessionId: LiveSessionId, connectionKey: string, identityKey?: string): Promise<number>;
  /** Heartbeat: refreshes the TTL so a long watch is not reaped. */
  touch(sessionId: LiveSessionId, connectionKey: string): Promise<void>;
  leave(sessionId: LiveSessionId, connectionKey: string): Promise<number>;
  count(sessionId: LiveSessionId): Promise<number>;
  addLikes(sessionId: LiveSessionId, count: number): Promise<number>;
  likes(sessionId: LiveSessionId): Promise<number>;
}

// --- Replaceable third-party providers -------------------------------------------

export interface PaymentIntent {
  readonly reference: string;
  readonly status: 'pending' | 'authorized' | 'paid' | 'failed';
  /** Where the buyer would be redirected. Null while payments are simulated. */
  readonly checkoutUrl: string | null;
}

/**
 * The seam Mercado Pago will plug into. `MockPaymentProvider` implements it in
 * M01; `MercadoPagoProvider` and `StripeProvider` will implement the same
 * interface without touching the checkout use case.
 */
export interface PaymentProvider {
  readonly key: string;
  createIntent(input: {
    orderId: OrderId;
    amountMinor: number;
    currency: CurrencyCode;
    installments: number;
    description: string;
  }): Promise<PaymentIntent>;
  confirm(input: { reference: string; outcome: 'approved' | 'rejected' }): Promise<PaymentIntent>;
}

/**
 * Where a session broadcasts, as the application sees it.
 *
 * M01 modelled this as an RTMP ingest URL plus a stream key, which is the
 * shape a broadcast-to-HLS product has. Real-time commerce needs sub-second
 * latency, so the model is a room a broadcaster and viewers both join. The
 * port changed rather than being worked around; LiveKit, Agora, Daily and
 * 100ms all fit this shape, and a future HLS provider would fit it too by
 * treating the "room" as a channel.
 */
export interface StreamChannel {
  readonly provider: string;
  readonly channelId: string;
  readonly url: string | null;
}

/**
 * A short-lived credential for **one participant**.
 *
 * Never stored, never reused, never sent to anyone but the participant it was
 * minted for. The provider secret stays on the server; the client only ever
 * receives one of these.
 */
export interface StreamCredentials {
  readonly url: string;
  readonly token: string;
  /** Who the provider will see. Stable per participant, not per connection. */
  readonly identity: string;
  readonly expiresAt: Date;
  readonly canPublish: boolean;
}

export interface ChannelParticipant {
  readonly identity: string;
  readonly displayName: string;
  readonly capabilities: LiveCapabilities;
  /** How long the credential stays valid. */
  readonly ttlSeconds: number;
}

/**
 * The seam every video vendor plugs into: LiveKit today, another tomorrow.
 *
 * Note what is *not* here — no notion of tracks, publications, ICE, SDP or
 * simulcast layers. Those belong to the adapter and to the browser SDK. The
 * application only asks for a channel and for credentials scoped to what a
 * given person is allowed to do.
 */
export interface StreamingProvider {
  readonly key: string;

  /** Provisions (or returns) the channel for a session. Idempotent. */
  openChannel(sessionId: LiveSessionId): Promise<StreamChannel>;

  /** Mints a credential with exactly the capabilities passed in. */
  issueCredentials(
    channel: StreamChannel,
    participant: ChannelParticipant,
  ): Promise<StreamCredentials>;

  /** Tears the channel down and disconnects anyone still attached. */
  closeChannel(channel: StreamChannel): Promise<void>;

  /** Live participant count from the provider, when it can report one. */
  countPublishers?(channel: StreamChannel): Promise<number>;
}

export type NotificationChannel = 'push' | 'email' | 'whatsapp';

export interface NotificationProvider {
  readonly key: string;
  notify(input: {
    userIds: readonly UserId[];
    channel: NotificationChannel;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void>;
}

export interface ShippingQuote {
  readonly methodId: string;
  readonly feeMinor: number;
  readonly estimate: string;
}

export interface ShippingProvider {
  readonly key: string;
  quote(input: {
    storeId: StoreId;
    methodId: string;
    regionCode: string | null;
    subtotalMinor: number;
  }): Promise<ShippingQuote>;
  createShipment(order: Order): Promise<{ trackingCode: string }>;
}

export interface StoredFile {
  readonly url: string;
  readonly key: string;
}

export interface StorageProvider {
  readonly key: string;
  /** Returns the URL a client should upload to, plus the final public URL. */
  createUploadTarget(input: {
    ownerId: UserId;
    contentType: string;
  }): Promise<{ uploadUrl: string; file: StoredFile }>;
}
