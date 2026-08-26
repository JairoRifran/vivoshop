import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  LiveSession,
  LiveSessionId,
  LiveStatus,
  Product,
  ProductId,
  Store,
  User,
  UserId,
} from '@vivo/domain';
import {
  DomainError,
  asLiveSessionId,
  asMessageId,
  asProductId,
  asStoreId,
  BROADCASTER_GRACE_SECONDS,
  assertLiveTransition,
  assertProductAttached,
  canIssueBroadcastCredentials,
  canIssueViewerCredentials,
  capabilitiesFor,
  elapsedSeconds,
  graceExpired,
  isFinished,
  sanitizeMessageBody,
  type LiveChannel,
  type UserId as DomainUserId,
} from '@vivo/domain';
import type {
  CreateLiveRequest,
  LiveDetailDto,
  LiveMessageDto,
  LiveStatsDto,
  LiveSummaryDto,
} from '@vivo/shared';
import { toLiveDetailDto, toLiveSummaryDto, toMessageDto } from '../mappers/dto.mappers';
import type {
  Clock,
  IdGenerator,
  NotificationProvider,
  PresenceStore,
  StreamChannel,
  StreamCredentials,
  StreamingProvider,
} from '../ports/infrastructure';
import type { RealtimePublisher } from '../ports/realtime';
import type {
  FollowRepository,
  LiveRepository,
  MessageRepository,
  OrderRepository,
  ProductRepository,
  StoreRepository,
} from '../ports/repositories';
import { ENV, type AppEnv } from '../../config/env';
import {
  CLOCK,
  FOLLOW_REPOSITORY,
  ID_GENERATOR,
  LIVE_REPOSITORY,
  MESSAGE_REPOSITORY,
  NOTIFICATION_PROVIDER,
  ORDER_REPOSITORY,
  PRESENCE_STORE,
  PRODUCT_REPOSITORY,
  REALTIME_PUBLISHER,
  STORE_REPOSITORY,
  STREAMING_PROVIDER,
} from '../ports/tokens';
import { LiveLogger } from './live-log';
import { StoreService } from './store.service';

@Injectable()
export class LiveService {
  private readonly log = new LiveLogger();

  constructor(
    @Inject(LIVE_REPOSITORY) private readonly sessions: LiveRepository,
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(PRESENCE_STORE) private readonly presence: PresenceStore,
    @Inject(STREAMING_PROVIDER) private readonly streaming: StreamingProvider,
    @Inject(NOTIFICATION_PROVIDER) private readonly notifications: NotificationProvider,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly storeService: StoreService,
  ) {}

  // --- Used by the realtime gateway ------------------------------------------

  /** Raw session lookup for the gateway; returns null instead of throwing. */
  async findSession(id: LiveSessionId): Promise<LiveSession | null> {
    return this.sessions.findById(id);
  }

  /**
   * Whether this user is the one allowed to broadcast the session.
   *
   * Derived from store ownership on the server. The socket never asks the
   * client who it is.
   */
  async isBroadcasterFor(session: LiveSession, userId: DomainUserId): Promise<boolean> {
    const store = await this.stores.findById(session.storeId);
    return Boolean(store && store.ownerId === userId);
  }

  // --- Reading -------------------------------------------------------------------

  async list(
    query: { status?: LiveStatus; limit?: number },
    viewerId: UserId | null,
  ): Promise<LiveSummaryDto[]> {
    const sessions = await this.sessions.list(query);
    return this.hydrateMany(sessions, viewerId);
  }

  /** Sessions from stores the viewer follows, for the personalised home rail. */
  async listFollowed(viewerId: UserId, limit = 10): Promise<LiveSummaryDto[]> {
    const storeIds = new Set((await this.follows.listStoreIds(viewerId)).map(String));
    if (storeIds.size === 0) return [];

    const sessions = (await this.sessions.list({}))
      .filter((session) => storeIds.has(String(session.storeId)))
      .filter((session) => session.status === 'live' || session.status === 'scheduled')
      .slice(0, limit);

    return this.hydrateMany(sessions, viewerId);
  }

  async detail(id: LiveSessionId, viewerId: UserId | null): Promise<LiveDetailDto> {
    const session = await this.requireSession(id);
    const context = await this.buildContext(session, viewerId);
    return toLiveDetailDto(session, context);
  }

  async listMessages(id: LiveSessionId, limit = 50): Promise<LiveMessageDto[]> {
    await this.requireSession(id);
    const messages = await this.messages.listBySession(id, limit);
    return messages.map(toMessageDto);
  }

  async postMessage(id: LiveSessionId, author: User, body: string): Promise<LiveMessageDto> {
    await this.requireSession(id);
    const clean = sanitizeMessageBody(body);

    const message = await this.messages.create({
      id: asMessageId(this.ids.generate('msg')),
      liveSessionId: id,
      authorId: author.id,
      authorName: author.name,
      authorAvatarUrl: author.avatarUrl,
      kind: 'chat',
      body: clean,
      createdAt: this.clock.now(),
    });

    return toMessageDto(message);
  }

  /**
   * Hearts are aggregated, never stored per tap. The persisted counter is the
   * historical total; the presence store holds what happened since boot.
   */
  async react(id: LiveSessionId, count: number): Promise<{ likeCount: number }> {
    const session = await this.requireSession(id);
    if (isFinished(session)) {
      throw new DomainError('LIVE_NOT_JOINABLE', 'This session is over', {
        status: session.status,
      });
    }
    const added = await this.presence.addLikes(id, count);
    return { likeCount: session.likeCount + added };
  }

  async join(id: LiveSessionId, viewerKey: string): Promise<{ viewerCount: number }> {
    const session = await this.requireSession(id);
    const live = await this.presence.join(id, viewerKey);
    return { viewerCount: session.viewerCount + live };
  }

  async leave(id: LiveSessionId, viewerKey: string): Promise<{ viewerCount: number }> {
    const session = await this.requireSession(id);
    const live = await this.presence.leave(id, viewerKey);
    return { viewerCount: session.viewerCount + live };
  }

  /** Counters for the seller's broadcast console. */
  async stats(id: LiveSessionId): Promise<LiveStatsDto> {
    const session = await this.requireSession(id);
    const store = await this.storeService.requireById(session.storeId);
    const [viewerCount, likes, orders] = await Promise.all([
      this.presence.count(id),
      this.presence.likes(id),
      this.orders.list({ liveSessionId: id }),
    ]);

    const billable = orders.filter((order) => order.status !== 'cancelled');

    return {
      liveSessionId: String(id),
      viewerCount: session.viewerCount + viewerCount,
      likeCount: session.likeCount + likes,
      ordersCount: billable.length,
      unitsSold: billable.reduce(
        (total, order) => total + order.items.reduce((sum, item) => sum + item.quantity, 0),
        0,
      ),
      revenueMinor: billable.reduce((total, order) => total + order.totalMinor, 0),
      currency: store.currency,
      elapsedSeconds: elapsedSeconds(session, this.clock.now()),
    };
  }

  // --- Seller surface ---------------------------------------------------------------

  async listForSeller(ownerId: UserId): Promise<LiveSummaryDto[]> {
    const store = await this.storeService.requireOwned(ownerId);
    const sessions = await this.sessions.list({ storeId: store.id });
    return this.hydrateMany(sessions, ownerId);
  }

  async create(ownerId: UserId, input: CreateLiveRequest): Promise<LiveDetailDto> {
    const store = await this.storeService.requireOwned(ownerId);
    const now = this.clock.now();

    const owned = await this.products.listByIds(input.productIds.map(asProductId));
    const attachable = owned.filter((product) => product.storeId === store.id);
    if (attachable.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Ninguno de los productos elegidos pertenece a tu tienda.',
      });
    }

    const startNow = input.mode === 'now';
    const sessionId = asLiveSessionId(this.ids.generate('liv'));

    // The channel is provisioned even against the mock provider, so the
    // ordering between "create session" and "provision channel" is already the
    // one a real provider needs.
    const channel: LiveChannel | null = startNow
      ? await this.streaming.openChannel(sessionId).then((opened) => ({
          provider: opened.provider,
          channelId: opened.channelId,
          url: opened.url,
        }))
      : null;

    const session: LiveSession = {
      id: sessionId,
      storeId: store.id,
      title: input.title.trim(),
      status: startNow ? 'live' : 'scheduled',
      thumbnailUrl: input.thumbnailUrl ?? `/media/live/${String(sessionId)}`,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      startedAt: startNow ? now : null,
      endedAt: null,
      viewerCount: 0,
      peakViewerCount: 0,
      likeCount: 0,
      products: attachable.map((product, position) => ({
        productId: product.id,
        position,
        soldCount: 0,
      })),
      featuredProductId: attachable[0]?.id ?? null,
      channel,
      interruptedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.sessions.create(session);
    if (startNow) {
      await this.publishState(created);
      await this.announce(created, store);
    }

    return toLiveDetailDto(created, await this.buildContext(created, ownerId));
  }

  /**
   * Takes a session on air.
   *
   * Goes scheduled -> starting -> live rather than jumping straight to live,
   * because provisioning a WebRTC room is a network call that can fail. A
   * session parked in `starting` tells the seller "connecting", which is true;
   * a session marked `live` with no room would tell everyone something false.
   */
  async start(ownerId: UserId, id: LiveSessionId): Promise<LiveDetailDto> {
    const { session, store } = await this.requireOwnedSession(ownerId, id);
    assertLiveTransition(session.status, 'starting');

    const startingAt = this.clock.now();
    const starting = await this.sessions.update({
      ...session,
      status: 'starting',
      updatedAt: startingAt,
    });
    await this.publishState(starting);
    this.log.log('live.starting', String(id), { storeId: String(store.id) });

    let channel: LiveChannel;
    try {
      const opened = await this.streaming.openChannel(id);
      channel = { provider: opened.provider, channelId: opened.channelId, url: opened.url };
    } catch (error) {
      // Roll back to something honest instead of stranding the seller in
      // "connecting" forever.
      const failedAt = this.clock.now();
      const failed = await this.sessions.update({
        ...starting,
        status: 'ended',
        endedAt: failedAt,
        updatedAt: failedAt,
      });
      await this.publishState(failed);
      this.log.warn('live.start_failed', String(id), {
        provider: this.streaming.key,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      throw new DomainError('STREAMING_UNAVAILABLE', 'Could not open the broadcast channel', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const now = this.clock.now();
    /**
     * Un vivo se anuncia una sola vez.
     *
     * Hoy esta condición no cambia nada: una reconexión vuelve por
     * `markResumed`, que no anuncia, y las transiciones no admiten volver a
     * `starting` desde `live`. Es una guarda, no la corrección de un error
     * existente, y se dice así para no atribuirle un mérito que no tiene.
     *
     * Existe igual porque el costo de equivocarse es asimétrico. El permiso de
     * avisos se pierde una sola vez: quien recibe tres notificaciones del mismo
     * vivo no silencia ese vivo, silencia la aplicación, y no se recupera. Una
     * línea que ata el anuncio al primer arranque cuesta menos que descubrir
     * por qué la gente dejó de recibir avisos.
     */
    const firstStart = session.startedAt === null;

    const updated = await this.sessions.update({
      ...starting,
      status: 'live',
      startedAt: session.startedAt ?? now,
      channel,
      interruptedAt: null,
      updatedAt: now,
    });

    await this.publishState(updated);
    if (firstStart) await this.announce(updated, store);
    this.log.log('live.started', String(id), {
      storeId: String(store.id),
      provider: channel.provider,
      // The channel id is ours, not a credential: it is what makes two log
      // lines from different services line up.
      channel: channel.channelId,
    });
    return toLiveDetailDto(updated, await this.buildContext(updated, ownerId));
  }

  // --- Streaming credentials ---------------------------------------------------

  /**
   * A publishing credential for the seller.
   *
   * Every check happens here, on the server: the caller is authenticated, owns
   * the store that owns the session, and the session is in a state that may be
   * broadcast into. The provider secret is never part of the response - only a
   * short-lived token scoped to this one participant.
   */
  async issueBroadcasterCredentials(
    ownerId: UserId,
    id: LiveSessionId,
  ): Promise<StreamCredentials & { provider: string; liveSessionId: string }> {
    const { session } = await this.requireOwnedSession(ownerId, id);

    if (!canIssueBroadcastCredentials(session)) {
      this.log.warn('live.credentials_denied', String(id), {
        role: 'broadcaster',
        status: session.status,
      });
      throw new DomainError('LIVE_NOT_JOINABLE', 'This session cannot be broadcast into', {
        status: session.status,
      });
    }

    const channel = await this.ensureChannel(session);
    const credentials = await this.streaming.issueCredentials(channel, {
      identity: `broadcaster_${String(ownerId)}`,
      displayName: 'Vendedor',
      capabilities: capabilitiesFor('broadcaster'),
      ttlSeconds: this.env.LIVEKIT_BROADCASTER_TTL_SECONDS,
    });

    // The token itself is never logged, here or anywhere.
    this.log.log('live.credentials_issued', String(id), {
      role: 'broadcaster',
      provider: channel.provider,
      identity: credentials.identity,
    });

    return { ...credentials, provider: channel.provider, liveSessionId: String(id) };
  }

  /**
   * A subscribe-only credential for a viewer, signed in or not.
   *
   * Watching must not require an account: the distribution model is a link
   * pasted into WhatsApp. Anonymous viewers get an ephemeral identity, and
   * either way the grant cannot publish media - enforced by the token, not by
   * the client behaving.
   */
  async issueViewerCredentials(
    id: LiveSessionId,
    viewer: { userId: UserId | null; identityKey: string; displayName: string },
  ): Promise<(StreamCredentials & { provider: string; liveSessionId: string }) | null> {
    const session = await this.requireSession(id);

    // Not an error: a scheduled or finished session simply has no video, and
    // the client renders the right thing for that state.
    if (!canIssueViewerCredentials(session) || !session.channel) return null;

    const credentials = await this.streaming.issueCredentials(session.channel, {
      identity: viewer.userId ? `viewer_${String(viewer.userId)}` : viewer.identityKey,
      displayName: viewer.displayName,
      capabilities: capabilitiesFor('viewer'),
      ttlSeconds: this.env.LIVEKIT_VIEWER_TTL_SECONDS,
    });

    return { ...credentials, provider: session.channel.provider, liveSessionId: String(id) };
  }

  /** Opens the channel on demand for a session that does not have one yet. */
  private async ensureChannel(session: LiveSession): Promise<StreamChannel> {
    if (session.channel) return session.channel;

    const opened = await this.streaming.openChannel(session.id);
    const channel: LiveChannel = {
      provider: opened.provider,
      channelId: opened.channelId,
      url: opened.url,
    };
    await this.sessions.update({ ...session, channel, updatedAt: this.clock.now() });
    return opened;
  }

  // --- Interruption and recovery -------------------------------------------------

  /**
   * The broadcaster connection dropped.
   *
   * Does NOT end the live. A phone changing cells, a lift, a Wi-Fi to data
   * handover: all of these look identical to a disconnect, and ending a
   * broadcast because someone walked behind a wall would destroy sales in
   * progress. The session is marked `interrupted` and the grace period starts.
   */
  async markInterrupted(id: LiveSessionId): Promise<void> {
    const session = await this.sessions.findById(id);
    if (!session || session.status !== 'live') return;

    this.log.warn('live.interrupted', String(id), { graceSeconds: BROADCASTER_GRACE_SECONDS });
    const now = this.clock.now();
    const updated = await this.sessions.update({
      ...session,
      status: 'interrupted',
      interruptedAt: now,
      updatedAt: now,
    });
    await this.publishState(updated);
  }

  /** The broadcaster came back inside the grace period. */
  async markResumed(id: LiveSessionId): Promise<void> {
    const session = await this.sessions.findById(id);
    if (!session || session.status !== 'interrupted') return;

    this.log.log('live.resumed', String(id), {
      downSeconds: session.interruptedAt
        ? Math.round((this.clock.now().getTime() - session.interruptedAt.getTime()) / 1000)
        : 0,
    });
    const now = this.clock.now();
    const updated = await this.sessions.update({
      ...session,
      status: 'live',
      interruptedAt: null,
      updatedAt: now,
    });
    await this.publishState(updated);
  }

  /**
   * Closes sessions whose broadcaster never came back.
   *
   * A scheduled sweep rather than a timer per session, so a process restart
   * cannot leave a broadcast stuck in `interrupted` forever.
   */
  async closeAbandonedSessions(): Promise<number> {
    const interrupted = await this.sessions.list({ status: 'interrupted' });
    const now = this.clock.now();
    let closed = 0;

    for (const session of interrupted) {
      if (!graceExpired(session, now)) continue;
      this.log.warn('live.abandoned', String(session.id), {
        graceSeconds: BROADCASTER_GRACE_SECONDS,
      });
      await this.finalizeSession(session, now);
      closed += 1;
    }
    return closed;
  }

  /**
   * Ends a broadcast: live -> ending -> ended.
   *
   * The intermediate state is not ceremony. Closing the provider channel is a
   * network call, and viewers need to be told the broadcast is finishing
   * before the video actually cuts, or the player just freezes.
   */
  async end(ownerId: UserId, id: LiveSessionId): Promise<LiveDetailDto> {
    const { session } = await this.requireOwnedSession(ownerId, id);
    assertLiveTransition(session.status, 'ending');

    const endingAt = this.clock.now();
    const ending = await this.sessions.update({
      ...session,
      status: 'ending',
      updatedAt: endingAt,
    });
    await this.publishState(ending);

    const updated = await this.finalizeSession(ending, this.clock.now());
    return toLiveDetailDto(updated, await this.buildContext(updated, ownerId));
  }

  /**
   * The single path from any active state to `ended`.
   *
   * Used both by a deliberate finish and by the abandoned-session sweep, so
   * the two can never drift in what they persist or what they announce.
   */
  private async finalizeSession(session: LiveSession, now: Date): Promise<LiveSession> {
    const finalViewers = session.viewerCount + (await this.presence.count(session.id));

    if (session.channel) {
      await this.streaming.closeChannel(session.channel).catch(() => undefined);
    }

    const updated = await this.sessions.update({
      ...session,
      status: 'ended',
      endedAt: now,
      viewerCount: 0,
      peakViewerCount: Math.max(session.peakViewerCount, finalViewers),
      likeCount: session.likeCount + (await this.presence.likes(session.id)),
      channel: null,
      interruptedAt: null,
      updatedAt: now,
    });

    await this.publishState(updated);
    this.log.log('live.ended', String(session.id), {
      peakViewers: updated.peakViewerCount,
      likes: updated.likeCount,
    });
    return updated;
  }

  async cancel(ownerId: UserId, id: LiveSessionId): Promise<LiveDetailDto> {
    const { session } = await this.requireOwnedSession(ownerId, id);
    assertLiveTransition(session.status, 'cancelled');

    const updated = await this.sessions.update({
      ...session,
      status: 'cancelled',
      updatedAt: this.clock.now(),
    });

    await this.publishState(updated);
    return toLiveDetailDto(updated, await this.buildContext(updated, ownerId));
  }

  /** The single most used control during a broadcast. */
  async feature(
    ownerId: UserId,
    id: LiveSessionId,
    productId: ProductId | null,
  ): Promise<LiveDetailDto> {
    const { session } = await this.requireOwnedSession(ownerId, id);
    if (productId) assertProductAttached(session, productId);

    const updated = await this.sessions.update({
      ...session,
      featuredProductId: productId,
      updatedAt: this.clock.now(),
    });

    // Authorised and persisted first, then broadcast. Viewers update without
    // a reload, and a client that missed the frame can still refetch and be
    // correct.
    await this.realtime.featuredProductChanged({
      liveSessionId: String(id),
      productId: productId ? String(productId) : null,
    });

    return toLiveDetailDto(updated, await this.buildContext(updated, ownerId));
  }

  /** Called by checkout so the seller console shows units sold per product. */
  async registerSale(
    id: LiveSessionId,
    sold: ReadonlyArray<{ productId: ProductId; quantity: number }>,
  ): Promise<void> {
    const session = await this.sessions.findById(id);
    if (!session) return;

    const byProduct = new Map(sold.map((entry) => [String(entry.productId), entry.quantity]));

    await this.sessions.update({
      ...session,
      products: session.products.map((entry) => ({
        ...entry,
        soldCount: entry.soldCount + (byProduct.get(String(entry.productId)) ?? 0),
      })),
      updatedAt: this.clock.now(),
    });
  }

  // --- Internals ----------------------------------------------------------------------

  async requireSession(id: LiveSessionId): Promise<LiveSession> {
    const session = await this.sessions.findById(id);
    if (!session) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transmisión inexistente.' });
    }
    return session;
  }

  private async requireOwnedSession(
    ownerId: UserId,
    id: LiveSessionId,
  ): Promise<{ session: LiveSession; store: Store }> {
    const store = await this.storeService.requireOwned(ownerId);
    const session = await this.requireSession(id);

    if (session.storeId !== store.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Esta transmisión no pertenece a tu tienda.',
      });
    }
    return { session, store };
  }

  /** Mirrors the persisted status onto the realtime channel. */
  private async publishState(session: LiveSession): Promise<void> {
    await this.realtime.liveStateChanged({
      liveSessionId: String(session.id),
      status: session.status,
      featuredProductId: session.featuredProductId ? String(session.featuredProductId) : null,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
    });
  }

  private async buildContext(session: LiveSession, viewerId: UserId | null) {
    const [store, products, presenceViewers, presenceLikes, isFollowing] = await Promise.all([
      this.storeService.requireById(session.storeId),
      this.products.listByIds(session.products.map((entry) => entry.productId)),
      this.presence.count(session.id),
      this.presence.likes(session.id),
      viewerId ? this.follows.exists(viewerId, session.storeId) : Promise.resolve(undefined),
    ]);

    return {
      store,
      products,
      viewerCount: session.viewerCount + presenceViewers,
      likeCount: session.likeCount + presenceLikes,
      ...(isFollowing === undefined ? {} : { isFollowing }),
    };
  }

  /**
   * Batches every lookup a list needs: stores, products and follow state are
   * each fetched once for the whole page rather than per session.
   */
  private async hydrateMany(
    sessions: LiveSession[],
    viewerId: UserId | null,
  ): Promise<LiveSummaryDto[]> {
    if (sessions.length === 0) return [];

    const storeIds = [...new Set(sessions.map((session) => String(session.storeId)))];
    const productIds = [
      ...new Set(sessions.flatMap((session) => session.products.map((entry) => String(entry.productId)))),
    ];

    const [stores, products, followedIds] = await Promise.all([
      this.stores.listByIds(storeIds.map(asStoreId)),
      this.products.listByIds(productIds.map(asProductId)),
      viewerId ? this.follows.listStoreIds(viewerId) : Promise.resolve([]),
    ]);

    const storeById = new Map(stores.map((store) => [String(store.id), store]));
    const productById = new Map(products.map((product) => [String(product.id), product]));
    const followed = new Set(followedIds.map(String));

    const hydrated = await Promise.all(
      sessions.map(async (session) => {
        const store = storeById.get(String(session.storeId));
        if (!store) return null;

        const sessionProducts = session.products
          .map((entry) => productById.get(String(entry.productId)))
          .filter((product): product is Product => Boolean(product));

        const [presenceViewers, presenceLikes] = await Promise.all([
          this.presence.count(session.id),
          this.presence.likes(session.id),
        ]);

        return toLiveSummaryDto(session, {
          store,
          products: sessionProducts,
          viewerCount: session.viewerCount + presenceViewers,
          likeCount: session.likeCount + presenceLikes,
          ...(viewerId ? { isFollowing: followed.has(String(session.storeId)) } : {}),
        });
      }),
    );

    return hydrated.filter((dto): dto is LiveSummaryDto => dto !== null);
  }

  /**
   * Le avisa a los seguidores que la tienda salió al aire.
   *
   * `listFollowerIds` devuelve solo a quienes tienen el aviso encendido — la
   * distinción vive en el repositorio y no acá, porque es una condición de
   * "a quién traer" y no de "qué hacer con ellos".
   *
   * Nunca tira: si el servicio de avisos está caído, el vivo empieza igual. Lo
   * que se pierde es una notificación, no una transmisión.
   */
  private async announce(session: LiveSession, store: Store): Promise<void> {
    const followers = await this.follows.listFollowerIds(store.id);
    if (followers.length === 0) return;

    await this.notifications.notify({
      userIds: followers,
      channel: 'push',
      title: `${store.name} está en vivo`,
      body: session.title,
      data: { liveSessionId: String(session.id), storeSlug: store.slug },
    });
  }
}
