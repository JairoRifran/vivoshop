import { Inject, Injectable, Logger } from '@nestjs/common';
import { getDeliveryMethod } from '@vivo/config';
import type { LiveSessionId, Order, StoreId } from '@vivo/domain';
import type {
  ChannelParticipant,
  IdGenerator,
  PushMessage,
  PushTarget,
  NotificationProvider,
  ShippingProvider,
  ShippingQuote,
  StorageProvider,
  StreamChannel,
  StreamCredentials,
  StreamingProvider,
} from '../../application/ports/infrastructure';
import { ID_GENERATOR } from '../../application/ports/tokens';
import { ENV, type AppEnv } from '../../config/env';

/**
 * The remaining external seams. Each one is a real implementation of its port,
 * so swapping in a vendor is a binding change in `InfrastructureModule`.
 *
 *   StreamingProvider    -> LiveKit (M02, see `livekit.provider.ts`)
 *   NotificationProvider -> FCM + APNs, email, WhatsApp Business
 *   ShippingProvider     -> DAC / Correo Uruguayo / UES
 *   StorageProvider      -> S3 / R2 with presigned uploads
 */

/**
 * Streaming without a video vendor.
 *
 * This is what keeps `pnpm dev` working with no credentials and no account,
 * and what the tests run against. It implements the full port — channels are
 * opened and closed, credentials are minted and expire — so every code path
 * above it behaves exactly as it will against LiveKit. What it cannot do is
 * carry pixels, and the clients know that from `url: null`: they render the
 * simulated stage instead of a player, which is honest rather than broken.
 */
@Injectable()
export class MockStreamingProvider implements StreamingProvider {
  readonly key = 'mock';

  private readonly logger = new Logger('MockStreaming');
  private readonly open = new Set<string>();

  async openChannel(sessionId: LiveSessionId): Promise<StreamChannel> {
    const channelId = `mock_${String(sessionId)}`;
    this.open.add(channelId);
    this.logger.log(`Mock channel open: ${channelId}`);
    // Null url is the signal: there is nothing to connect to.
    return { provider: this.key, channelId, url: null };
  }

  async issueCredentials(
    channel: StreamChannel,
    participant: ChannelParticipant,
  ): Promise<StreamCredentials> {
    return {
      url: '',
      // Structured, obviously fake, and impossible to mistake for a JWT.
      token: `mock-token.${channel.channelId}.${participant.identity}`,
      identity: participant.identity,
      expiresAt: new Date(Date.now() + participant.ttlSeconds * 1000),
      canPublish: participant.capabilities.canPublishMedia,
    };
  }

  async closeChannel(channel: StreamChannel): Promise<void> {
    this.open.delete(channel.channelId);
    this.logger.log(`Mock channel closed: ${channel.channelId}`);
  }

  async countPublishers(channel: StreamChannel): Promise<number> {
    return this.open.has(channel.channelId) ? 1 : 0;
  }
}

@Injectable()
export class LogNotificationProvider implements NotificationProvider {
  readonly key = 'log';

  private readonly logger = new Logger(LogNotificationProvider.name);

  /**
   * Escribe una línea y dice que entregó todo.
   *
   * "Entregado" es la respuesta honesta para este adaptador: no hay servidor de
   * push que pueda rechazar nada, así que ningún destino está muerto. Devolver
   * `gone` con contenido haría que el servicio diera de baja suscripciones
   * perfectamente válidas en desarrollo.
   */
  async send(input: {
    targets: readonly PushTarget[];
    message: PushMessage;
  }): Promise<{ delivered: readonly string[]; gone: readonly string[] }> {
    this.logger.log(
      `"${input.message.title}" -> ${input.targets.length} dispositivo(s): ${input.message.body}`,
    );
    return { delivered: input.targets.map((target) => target.endpoint), gone: [] };
  }
}

@Injectable()
export class FlatRateShippingProvider implements ShippingProvider {
  readonly key = 'flat-rate';

  constructor(@Inject(ID_GENERATOR) private readonly ids: IdGenerator) {}

  /**
   * Quotes straight from the market configuration. A real carrier integration
   * keeps this signature and starts using `regionCode` and weight.
   */
  async quote(input: {
    storeId: StoreId;
    methodId: string;
    regionCode: string | null;
    subtotalMinor: number;
  }): Promise<ShippingQuote> {
    const method = getDeliveryMethod('UY', input.methodId);
    return {
      methodId: input.methodId,
      feeMinor: method?.flatFeeMinor ?? 0,
      estimate: method?.estimate ?? 'A coordinar',
    };
  }

  async createShipment(_order: Order): Promise<{ trackingCode: string }> {
    return { trackingCode: this.ids.generate('trk').toUpperCase().slice(0, 16) };
  }
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly key = 'local';

  /**
   * Los archivos, en memoria.
   *
   * Es el driver de desarrollo, y hace lo mismo que el de datos: existe para
   * que un clon del repositorio arranque sin que nadie contrate un bucket. Los
   * bytes mueren con el proceso, que es exactamente lo que se quiere en una
   * suite de pruebas y lo que lo hace inservible en producción — por eso el
   * arranque avisa si alguien lo deja puesto ahí.
   *
   * A diferencia de Supabase, acá los bytes **sí** pasan por la API. Es una
   * concesión del entorno de desarrollo, no del diseño: `MediaController` los
   * recibe y los devuelve, y en producción esa ruta no la usa nadie.
   */
  private readonly files = new Map<string, { contentType: string; bytes: Buffer }>();

  /**
   * Absolutas, y bajo `media/dev`.
   *
   * Absolutas porque la web corre en otro origen: una ruta relativa la
   * resolvería el navegador contra el frontend y no llegaría nunca —donde
   * además `/media/:kind/:seed` ya existe generando imágenes de relleno.
   */
  private readonly base: string;

  constructor(@Inject(ENV) env: AppEnv) {
    this.base = env.API_PUBLIC_URL.replace(/\/+$/, '');
  }

  async createUploadTarget(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<{ uploadUrl: string; expiresAt: Date }> {
    return {
      uploadUrl: `${this.base}/media/dev/upload/${input.key}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
    };
  }

  publicUrl(key: string): string {
    return `${this.base}/media/dev/file/${key}`;
  }

  keyFromPublicUrl(url: string): string | null {
    const prefijo = `${this.base}/media/dev/file/`;
    if (!url.startsWith(prefijo)) return null;
    const clave = url.slice(prefijo.length);
    return clave.length > 0 ? clave : null;
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }

  /** Guarda los bytes. Solo lo llama `MediaController`, y solo con este driver. */
  put(key: string, contentType: string, bytes: Buffer): void {
    this.files.set(key, { contentType, bytes });
  }

  get(key: string): { contentType: string; bytes: Buffer } | null {
    return this.files.get(key) ?? null;
  }
}
