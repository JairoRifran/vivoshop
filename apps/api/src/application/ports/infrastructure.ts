import type { CurrencyCode } from '@vivo/config';
import type {
  AuthProvider,
  ProviderProfile,
  LiveCapabilities,
  LiveSessionId,
  Order,
  OrderId,
  PaymentStatus,
  StoreId,
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
  readonly status: PaymentStatus;
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

/** Un destino concreto: el navegador y las claves con las que descifra. */
export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Lo que se muestra, y lo que el service worker necesita para abrir el vivo.
 *
 * `data` viaja al navegador tal cual, así que **nunca** lleva email, tokens ni
 * nada privado: lo mínimo para armar la notificación y saber a dónde ir.
 */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, string>;
}

/**
 * El transporte, y solo el transporte.
 *
 * A quién avisarle y cuántas veces lo decide `NotificationService`. Este puerto
 * recibe destinos ya resueltos y ya reservados. La separación importa: la regla
 * de "un aviso por vivo y por dispositivo" tiene que valer igual el día que el
 * transporte sea otro.
 */
export interface NotificationProvider {
  readonly key: string;
  /**
   * Envía a los destinos indicados.
   *
   * Nunca tira: devuelve qué se entregó y qué destinos están muertos, y el
   * llamador decide qué hacer con eso. Un servicio de push caído no puede
   * voltear la operación que disparó el aviso.
   */
  send(input: {
    targets: readonly PushTarget[];
    message: PushMessage;
  }): Promise<{ delivered: readonly string[]; gone: readonly string[] }>;
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

/**
 * Dónde viven las imágenes.
 *
 * ## Por qué los bytes no pasan por la API
 *
 * El navegador pide un destino, sube **directo** al almacenamiento, y después
 * nos manda la clave. La API nunca ve el archivo. La alternativa —recibirlo y
 * reenviarlo— haría que cada foto de perfil ocupe un proceso de Node durante
 * toda la subida, que en un teléfono con 4G puede ser medio minuto, y pondría
 * el límite de tamaño en manos del servidor equivocado.
 *
 * ## Lo que vuelve es una clave, no una URL
 *
 * `createUploadTarget` decide la clave; el llamador la guarda y arma la URL
 * pública con `publicUrl`. Que el cliente no elija la URL es lo que impide que
 * alguien ponga en su avatar la foto de otro —o una baliza de un servidor
 * ajeno—. La comprobación vive en `assertOwnMediaKey`, en el dominio.
 */
/**
 * Un tercero que afirma quien es alguien.
 *
 * Dos metodos y ninguna decision de producto: manda a la persona al proveedor,
 * y despues cambia el codigo por un perfil. **A quien pertenece ese perfil
 * --entrar, vincular, registrar o pedir la contrasena-- lo decide el dominio**,
 * en `resolveIdentityOutcome`. Es la misma separacion que hace que el adaptador
 * de Mercado Pago no sepa de comisiones.
 */
export interface IdentityProvider {
  readonly key: AuthProvider;
  /**
   * A donde mandar a la persona.
   *
   * `codeChallenge` es PKCE: el verificador queda del lado del servidor, asi
   * que un codigo de autorizacion interceptado --en un historial, en un log de
   * un proxy, en un `Referer`-- no se puede canjear sin el.
   */
  authorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<ProviderProfile>;
}

export interface StorageProvider {
  readonly key: string;
  /**
   * Un destino para subir, con vencimiento.
   *
   * `uploadUrl` es de un solo uso y dura poco: es una autorización para
   * escribir un archivo concreto, no una llave del bucket.
   */
  createUploadTarget(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<{ uploadUrl: string; expiresAt: Date }>;
  /** La URL pública de una clave ya subida. */
  publicUrl(key: string): string;
}
