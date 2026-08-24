import { Inject, Injectable, Logger } from '@nestjs/common';
import { getDeliveryMethod } from '@vivo/config';
import type { LiveSessionId, Order, StoreId, UserId } from '@vivo/domain';
import type {
  ChannelParticipant,
  IdGenerator,
  NotificationChannel,
  NotificationProvider,
  ShippingProvider,
  ShippingQuote,
  StorageProvider,
  StreamChannel,
  StreamCredentials,
  StreamingProvider,
} from '../../application/ports/infrastructure';
import { ID_GENERATOR } from '../../application/ports/tokens';

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

  async notify(input: {
    userIds: readonly UserId[];
    channel: NotificationChannel;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    this.logger.log(
      `[${input.channel}] "${input.title}" -> ${input.userIds.length} destinatario(s): ${input.body}`,
    );
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

  constructor(@Inject(ID_GENERATOR) private readonly ids: IdGenerator) {}

  /**
   * M01 stores no binaries: product imagery is rendered on demand by the web
   * app from a deterministic key. The signature already matches a presigned
   * S3 upload so the client-side upload flow will not need rewriting.
   */
  async createUploadTarget(_input: {
    ownerId: UserId;
    contentType: string;
  }): Promise<{ uploadUrl: string; file: { url: string; key: string } }> {
    const key = this.ids.generate('file');
    return {
      uploadUrl: `/uploads/${key}`,
      file: { key, url: `/media/upload/${key}` },
    };
  }
}
