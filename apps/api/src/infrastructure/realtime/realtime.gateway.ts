import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  REALTIME_COMMANDS,
  REALTIME_EVENTS,
  asLiveSessionId,
  consumeChatToken,
  isFinished,
  newChatBucket,
  sanitizeMessageBody,
  type ChatBucket,
  type LiveSessionId,
  type RealtimeIdentity,
  type StoreId,
} from '@vivo/domain';
import type { Server, Socket } from 'socket.io';
import type { PresenceStore } from '../../application/ports/infrastructure';
import { PRESENCE_STORE, USER_REPOSITORY } from '../../application/ports/tokens';
import type { UserRepository } from '../../application/ports/repositories';
import { LiveService } from '../../application/services/live.service';
import { TokenService } from '../security/token.service';

/**
 * The realtime channel for business events.
 *
 * Deliberately separate from the video connection. Three reasons, in order of
 * weight: an anonymous viewer must be able to watch chat and presence even
 * when the streaming provider is the mock and there is no room to join; the
 * events here are ours and must survive changing video vendor; and routing
 * chat through the media data channel would bypass the authentication and rate
 * limiting that live on this side.
 *
 * ## What this gateway will and will not accept
 *
 * It fans out, and it accepts exactly two commands that create ephemeral or
 * cheap durable state: a chat message and a burst of hearts. Anything that
 * changes what the shop sells or what state a broadcast is in — featuring a
 * product, ending a live — goes over HTTP, through the same guards as every
 * other mutation. A socket frame is not a place to re-implement authorisation.
 *
 * Identity is derived from the handshake token, never from the payload. A
 * client that sends `{ userId: 'martina' }` is ignored.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: false },
  // The browser reconnects on its own; these keep a dead socket from lingering
  // long enough to inflate the viewer count.
  pingInterval: 20_000,
  pingTimeout: 25_000,
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger('Realtime');

  /** Chat budget per identity, not per socket: a new tab is not a fresh quota. */
  private readonly chatBuckets = new Map<string, ChatBucket>();

  constructor(
    @Inject(PRESENCE_STORE) private readonly presence: PresenceStore,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly tokens: TokenService,
    @Inject(forwardRef(() => LiveService)) private readonly live: LiveService,
  ) {}

  // --- Connection lifecycle -------------------------------------------------

  /**
   * Sets up the socket without awaiting anything first.
   *
   * Socket.IO does not hold incoming packets while this runs, so a client that
   * emits `live.join` immediately after `connect` can arrive mid-handshake.
   * Anything a handler needs must therefore exist synchronously: the room set
   * is created here, and the identity is stored as a *promise* that handlers
   * await. Resolving it lazily would mean a signed-in user's first message is
   * treated as anonymous.
   */
  handleConnection(socket: Socket): void {
    socket.data.rooms = new Set<string>();
    socket.data.identity = this.resolveIdentity(socket).then((identity) => {
      this.logger.debug?.(`connected ${socket.id} as ${identity.key}`);
      return identity;
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const joined: Set<string> = socket.data.rooms ?? new Set<string>();

    // Presence must be released even on an abrupt drop, or the count only
    // ever grows. The store's TTL is the backstop; this is the fast path.
    for (const sessionId of joined) {
      const count = await this.presence.leave(asLiveSessionId(sessionId), socket.id);
      this.emitViewerCount(sessionId, count);

      // A broadcaster dropping does not end the broadcast — it starts the
      // grace period. `LiveJanitor` closes it only if they never come back.
      if (socket.data.isBroadcaster === true) {
        await this.live.markInterrupted(asLiveSessionId(sessionId));
      }
    }
    socket.data.rooms = new Set();
  }

  // --- Commands ---------------------------------------------------------------

  @SubscribeMessage(REALTIME_COMMANDS.join)
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { liveSessionId?: string },
  ): Promise<{ ok: boolean; viewerCount?: number; error?: string }> {
    const sessionId = String(body?.liveSessionId ?? '');
    if (!sessionId) return { ok: false, error: 'LIVE_NOT_JOINABLE' };

    const session = await this.live.findSession(asLiveSessionId(sessionId));
    if (!session) return { ok: false, error: 'NOT_FOUND' };

    const identity = await this.identityOf(socket);

    await socket.join(roomOf(sessionId));
    this.roomsOf(socket).add(sessionId);

    // The seller of this store gets a second, private room. Order events with
    // revenue in them are published there and nowhere else.
    if (identity.userId && (await this.live.isBroadcasterFor(session, identity.userId))) {
      await socket.join(sellerRoomOf(sessionId));
      socket.data.isBroadcaster = true;
      // The seller reappearing is what ends an interruption. No-op unless the
      // session is actually in `interrupted`.
      await this.live.markResumed(session.id);
    }

    const count = await this.presence.join(asLiveSessionId(sessionId), socket.id, identity.key);
    this.emitViewerCount(sessionId, count);

    // A late joiner needs the current state, not just future changes.
    socket.emit(REALTIME_EVENTS.liveState, {
      liveSessionId: sessionId,
      status: session.status,
      featuredProductId: session.featuredProductId ? String(session.featuredProductId) : null,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    });

    return { ok: true, viewerCount: count };
  }

  @SubscribeMessage(REALTIME_COMMANDS.leave)
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { liveSessionId?: string },
  ): Promise<{ ok: boolean }> {
    const sessionId = String(body?.liveSessionId ?? '');
    if (!sessionId) return { ok: false };

    await socket.leave(roomOf(sessionId));
    await socket.leave(sellerRoomOf(sessionId));
    this.roomsOf(socket).delete(sessionId);

    const count = await this.presence.leave(asLiveSessionId(sessionId), socket.id);
    this.emitViewerCount(sessionId, count);
    return { ok: true };
  }

  /** Keeps a long watch from being reaped as a ghost. */
  @SubscribeMessage('live.heartbeat')
  async onHeartbeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { liveSessionId?: string },
  ): Promise<{ ok: boolean }> {
    const sessionId = String(body?.liveSessionId ?? '');
    if (sessionId) await this.presence.touch(asLiveSessionId(sessionId), socket.id);
    return { ok: true };
  }

  @SubscribeMessage(REALTIME_COMMANDS.sendChat)
  async onChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { liveSessionId?: string; body?: string },
  ): Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }> {
    const identity = await this.identityOf(socket);
    // Watching is anonymous; writing is not. Requiring an account to type is
    // the cheapest abuse control there is, and it costs no viewer.
    if (!identity.userId) return { ok: false, error: 'UNAUTHORIZED' };

    const sessionId = String(body?.liveSessionId ?? '');
    const text = sanitizeMessageBody(String(body?.body ?? ''));
    if (!sessionId || text.length === 0) return { ok: false, error: 'VALIDATION_ERROR' };

    const now = Date.now();
    const bucket = this.chatBuckets.get(identity.key) ?? newChatBucket(now);
    const allowance = consumeChatToken(bucket, now);
    this.chatBuckets.set(identity.key, allowance.bucket);

    if (!allowance.allowed) {
      return {
        ok: false,
        error: 'RATE_LIMITED',
        retryAfterSeconds: allowance.retryAfterSeconds,
      };
    }

    const session = await this.live.findSession(asLiveSessionId(sessionId));
    if (!session || isFinished(session)) return { ok: false, error: 'LIVE_NOT_JOINABLE' };

    const author = await this.users.findById(identity.userId);
    if (!author) return { ok: false, error: 'UNAUTHORIZED' };

    // Persisted first, broadcast second: the socket is a notification channel,
    // never the source of truth. A client that missed the frame can refetch.
    const message = await this.live.postMessage(session.id, author, text);
    this.server.to(roomOf(sessionId)).emit(REALTIME_EVENTS.chatMessage, {
      ...message,
      liveSessionId: sessionId,
    });

    return { ok: true };
  }

  @SubscribeMessage(REALTIME_COMMANDS.sendReaction)
  async onReaction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { liveSessionId?: string; count?: number },
  ): Promise<{ ok: boolean; totalLikes?: number }> {
    const sessionId = String(body?.liveSessionId ?? '');
    if (!sessionId) return { ok: false };

    // Clamped rather than rejected: a burst of taps is the intended behaviour,
    // and a client claiming a thousand hearts is simply not believed.
    const count = Math.min(Math.max(1, Number(body?.count ?? 1)), 30);
    const total = await this.live.react(asLiveSessionId(sessionId), count);

    // Broadcast to everyone else; the sender already animated its own taps.
    socket.to(roomOf(sessionId)).emit(REALTIME_EVENTS.reactionBurst, {
      liveSessionId: sessionId,
      count,
      totalLikes: total.likeCount,
    });

    return { ok: true, totalLikes: total.likeCount };
  }

  // --- Server-side fan-out ------------------------------------------------------

  emitToLive(sessionId: string, event: string, payload: unknown): void {
    this.server?.to(roomOf(sessionId)).emit(event, payload);
  }

  emitToSeller(sessionId: string, event: string, payload: unknown): void {
    this.server?.to(sellerRoomOf(sessionId)).emit(event, payload);
  }

  async roomSize(sessionId: LiveSessionId): Promise<number> {
    const sockets = await this.server?.in(roomOf(String(sessionId))).fetchSockets();
    return sockets?.length ?? 0;
  }

  private emitViewerCount(sessionId: string, viewerCount: number): void {
    this.server?.to(roomOf(sessionId)).emit(REALTIME_EVENTS.viewerCount, {
      liveSessionId: sessionId,
      viewerCount,
    });
  }

  // --- Identity -------------------------------------------------------------------

  /**
   * Derived from the handshake token alone.
   *
   * An anonymous viewer gets a `guest_` identity so presence and rate limiting
   * still work — watching must never require an account, because the whole
   * distribution model is a link pasted into WhatsApp.
   */
  private async resolveIdentity(socket: Socket): Promise<RealtimeIdentity> {
    const raw =
      (socket.handshake.auth?.token as string | undefined) ??
      stripBearer(socket.handshake.headers.authorization);

    if (raw) {
      // Realtime audience only: a session cookie is not accepted here, and a
      // realtime token is not accepted by the REST API.
      const claims = await this.tokens.verifyRealtime(raw);
      const user = claims ? await this.users.findById(claims.userId) : null;
      if (user && user.status === 'active') {
        return {
          key: `user_${String(user.id)}`,
          userId: user.id,
          displayName: user.name,
          avatarUrl: user.avatarUrl,
        };
      }
    }

    return {
      key: `guest_${socket.id}`,
      userId: null,
      displayName: 'Invitado',
      avatarUrl: null,
    };
  }

  /** Awaits the handshake resolution started in `handleConnection`. */
  private async identityOf(socket: Socket): Promise<RealtimeIdentity> {
    const pending = socket.data.identity as Promise<RealtimeIdentity> | undefined;
    if (pending) return pending;

    // Only reachable if a handler somehow runs before `handleConnection`.
    return {
      key: `guest_${socket.id}`,
      userId: null,
      displayName: 'Invitado',
      avatarUrl: null,
    };
  }

  private roomsOf(socket: Socket): Set<string> {
    const rooms = socket.data.rooms as Set<string> | undefined;
    if (rooms) return rooms;

    const created = new Set<string>();
    socket.data.rooms = created;
    return created;
  }
}

export function roomOf(sessionId: string): string {
  return `live:${sessionId}`;
}

export function sellerRoomOf(sessionId: string): string {
  return `live:${sessionId}:seller`;
}

/** Store ids are never taken from the client; this keeps the type honest. */
export type SellerRoomKey = `live:${string}:seller` & { readonly store?: StoreId };

function stripBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
}
