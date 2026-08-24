import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, type LiveSessionId } from '@vivo/domain';
import { AccessToken, RoomServiceClient, type VideoGrant } from 'livekit-server-sdk';
import type {
  ChannelParticipant,
  StreamChannel,
  StreamCredentials,
  StreamingProvider,
} from '../../application/ports/infrastructure';
import { ENV, type AppEnv } from '../../config/env';

/**
 * LiveKit adapter.
 *
 * The only file in the codebase that knows what a `VideoGrant` is. Everything
 * above it speaks in `LiveCapabilities`, which is why swapping LiveKit for
 * Agora or Daily is a new file next to this one rather than a refactor.
 *
 * Chosen for M02 because live commerce needs sub-second latency both ways —
 * a buyer asks "¿tenés talle M?" and expects the seller to answer while they
 * are still watching — and because it runs identically against a local server
 * and against LiveKit Cloud, so development needs no account.
 *
 * ## Security
 *
 * `LIVEKIT_API_SECRET` never leaves this process. Tokens are minted here, per
 * participant, with the narrowest grant that participant needs, and they
 * expire. A viewer's token cannot publish; that is enforced by the grant, not
 * by the client being polite.
 */
@Injectable()
export class LiveKitStreamingProvider implements StreamingProvider {
  readonly key = 'livekit';

  private readonly logger = new Logger('LiveKit');
  private readonly rooms: RoomServiceClient;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    // The management API is HTTP; the client SDK connects over WebSocket to
    // the same host. Deriving one from the other keeps configuration to a
    // single variable.
    const httpUrl = env.LIVEKIT_URL!.replace(/^ws/, 'http');
    this.rooms = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
  }

  /**
   * Rooms are named after the session, so provisioning is idempotent and a
   * reconnecting broadcaster lands back where it was.
   *
   * LiveKit creates rooms implicitly on first join, so an unreachable server
   * here is not fatal: the channel descriptor is still valid and the client
   * will surface the connection failure with a better message than we could.
   */
  async openChannel(sessionId: LiveSessionId): Promise<StreamChannel> {
    const channelId = `live_${String(sessionId)}`;

    try {
      await this.rooms.createRoom({
        name: channelId,
        // Reaped shortly after the last participant leaves, which is what
        // makes an abandoned broadcast stop costing anything.
        emptyTimeout: 120,
        departureTimeout: 20,
        maxParticipants: this.env.LIVEKIT_MAX_PARTICIPANTS,
      });
      this.logger.log(`Room ready: ${channelId}`);
    } catch (error) {
      this.logger.warn(
        `Could not pre-create ${channelId}; it will be created on first join: ${describe(error)}`,
      );
    }

    return { provider: this.key, channelId, url: this.env.LIVEKIT_URL! };
  }

  async issueCredentials(
    channel: StreamChannel,
    participant: ChannelParticipant,
  ): Promise<StreamCredentials> {
    const { capabilities } = participant;

    const grant: VideoGrant = {
      room: channel.channelId,
      roomJoin: true,
      canSubscribe: capabilities.canSubscribe,
      canPublish: capabilities.canPublishMedia,
      // Data messages travel over our own socket, which is authenticated and
      // rate limited. Letting the media channel carry them would route chat
      // around every check we have.
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomAdmin: capabilities.canModerate,
      roomCreate: false,
    };

    const token = new AccessToken(this.env.LIVEKIT_API_KEY!, this.env.LIVEKIT_API_SECRET!, {
      identity: participant.identity,
      name: participant.displayName,
      ttl: participant.ttlSeconds,
    });
    token.addGrant(grant);

    return {
      url: channel.url ?? this.env.LIVEKIT_URL!,
      token: await token.toJwt(),
      identity: participant.identity,
      expiresAt: new Date(Date.now() + participant.ttlSeconds * 1000),
      canPublish: capabilities.canPublishMedia,
    };
  }

  async closeChannel(channel: StreamChannel): Promise<void> {
    try {
      await this.rooms.deleteRoom(channel.channelId);
      this.logger.log(`Room closed: ${channel.channelId}`);
    } catch (error) {
      // A room that is already gone is the desired end state.
      this.logger.warn(`Could not close ${channel.channelId}: ${describe(error)}`);
    }
  }

  async countPublishers(channel: StreamChannel): Promise<number> {
    try {
      const participants = await this.rooms.listParticipants(channel.channelId);
      return participants.filter((participant) => participant.permission?.canPublish).length;
    } catch {
      return 0;
    }
  }
}

/**
 * Provider failures become one stable internal code. A LiveKit stack trace is
 * useless to a seller and dangerous in a response body.
 */
export function streamingUnavailable(cause: unknown): DomainError {
  return new DomainError('STREAMING_UNAVAILABLE', 'The streaming provider is unavailable', {
    cause: describe(cause),
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
