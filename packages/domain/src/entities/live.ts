import { DomainError } from '../errors';
import type {
  LiveSessionId,
  MessageId,
  ProductId,
  StoreId,
  UserId,
  VariantId,
} from '../value-objects/identifiers';

export const LIVE_STATUSES = [
  'scheduled',
  /** Provisioning the channel and waiting for the camera to publish. */
  'starting',
  'live',
  /** The broadcaster dropped. Recoverable until the grace period expires. */
  'interrupted',
  /** Winding down: the channel is closing but the record is not final yet. */
  'ending',
  'ended',
  'cancelled',
] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/**
 * Allowed status moves. Keeping the graph as data (instead of scattered `if`s)
 * means the API, the seller UI and the tests all agree on what is legal.
 *
 * `starting` and `ending` exist because provisioning a WebRTC room and tearing
 * it down are network operations that take time and can fail. Without them the
 * UI has to guess whether "not live yet" means connecting or broken.
 *
 * `interrupted` is the one that matters commercially: a phone that loses signal
 * for fifteen seconds has not ended its broadcast, and marking it `ended` would
 * destroy a sale in progress. It is recoverable, and only a grace period turns
 * it into `ended`.
 */
const LIVE_TRANSITIONS: Record<LiveStatus, readonly LiveStatus[]> = {
  scheduled: ['starting', 'cancelled'],
  // A start that never connects fails backwards, not into a fake live.
  starting: ['live', 'ended', 'cancelled'],
  live: ['interrupted', 'ending'],
  interrupted: ['live', 'ending', 'ended'],
  ending: ['ended'],
  ended: [],
  cancelled: [],
};

/** States in which the channel exists and the seller is on air or trying to be. */
export const ACTIVE_LIVE_STATUSES: readonly LiveStatus[] = [
  'starting',
  'live',
  'interrupted',
  'ending',
];

/** States a buyer should be shown a player for. */
export const WATCHABLE_LIVE_STATUSES: readonly LiveStatus[] = ['live', 'interrupted'];

export function canTransitionLive(from: LiveStatus, to: LiveStatus): boolean {
  return LIVE_TRANSITIONS[from].includes(to);
}

export function assertLiveTransition(from: LiveStatus, to: LiveStatus): void {
  if (!canTransitionLive(from, to)) {
    throw new DomainError('INVALID_LIVE_TRANSITION', 'Live session cannot change to that status', {
      from,
      to,
    });
  }
}

/**
 * Where a session is being broadcast, in terms the domain can hold without
 * knowing what a "room" is to any particular vendor.
 */
export interface LiveChannel {
  /** Which `StreamingProvider` owns it, e.g. `livekit` or `mock`. */
  readonly provider: string;
  /** The provider's identifier for the channel. */
  readonly channelId: string;
  /** Where clients connect. Null for providers that do not need one. */
  readonly url: string | null;
}

/**
 * How long a dropped broadcaster keeps the session alive.
 *
 * Ninety seconds is a judgement call, and the reasoning is worth writing down:
 * a mobile network handing off between cells or from Wi-Fi to data typically
 * recovers in under thirty, and a seller who walks behind a wall should not
 * lose the sale. Much longer and buyers stare at a frozen player wondering if
 * anyone is there.
 */
export const BROADCASTER_GRACE_SECONDS = 90;

export function graceExpired(
  session: Pick<LiveSession, 'interruptedAt'>,
  now: Date = new Date(),
  graceSeconds: number = BROADCASTER_GRACE_SECONDS,
): boolean {
  if (!session.interruptedAt) return false;
  return (now.getTime() - session.interruptedAt.getTime()) / 1000 >= graceSeconds;
}

/** A product pinned to a session, with the order the seller arranged. */
export interface LiveProduct {
  readonly productId: ProductId;
  readonly position: number;
  /** Units sold during this session. Drives the seller's live counters. */
  readonly soldCount: number;
}

export interface LiveSession {
  readonly id: LiveSessionId;
  readonly storeId: StoreId;
  readonly title: string;
  readonly status: LiveStatus;
  readonly thumbnailUrl: string | null;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly viewerCount: number;
  readonly peakViewerCount: number;
  readonly likeCount: number;
  readonly products: readonly LiveProduct[];
  /** The product currently on screen. Null between highlights. */
  readonly featuredProductId: ProductId | null;
  /**
   * The provider channel this session broadcasts through. Null before it is
   * provisioned and after it is torn down.
   *
   * Deliberately not a `playbackUrl`: WebRTC has no such thing. What a client
   * needs is somewhere to connect and a token, and the token is never stored —
   * it is minted per participant, per request, with the narrowest grant that
   * participant needs.
   */
  readonly channel: LiveChannel | null;
  /** When the broadcaster dropped. Drives the grace period. */
  readonly interruptedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isLive(session: Pick<LiveSession, 'status'>): boolean {
  return session.status === 'live';
}

/** True while the session owns a provider channel, on air or reconnecting. */
export function isActiveLive(session: Pick<LiveSession, 'status'>): boolean {
  return ACTIVE_LIVE_STATUSES.includes(session.status);
}

export function isWatchable(session: Pick<LiveSession, 'status'>): boolean {
  return WATCHABLE_LIVE_STATUSES.includes(session.status);
}

export function isFinished(session: Pick<LiveSession, 'status'>): boolean {
  return session.status === 'ended' || session.status === 'cancelled';
}

// --- Participants -------------------------------------------------------------

/**
 * What a participant may do in a session, expressed in domain terms.
 *
 * The streaming provider translates this into its own grant vocabulary. The
 * application never says "canPublishData" or "roomAdmin"; it says whether this
 * person is the one holding the camera.
 */
export type LiveRole = 'broadcaster' | 'viewer';

export interface LiveCapabilities {
  readonly canPublishMedia: boolean;
  readonly canSubscribe: boolean;
  /** Reserved for a future co-host or moderator role. */
  readonly canModerate: boolean;
}

export const BROADCASTER_CAPABILITIES: LiveCapabilities = {
  canPublishMedia: true,
  canSubscribe: true,
  canModerate: false,
};

/**
 * Least privilege, and deliberately not negotiable from the client: a viewer
 * cannot publish a camera, cannot publish data, and cannot touch room
 * metadata. Everything a viewer does that changes state goes through the API.
 */
export const VIEWER_CAPABILITIES: LiveCapabilities = {
  canPublishMedia: false,
  canSubscribe: true,
  canModerate: false,
};

export function capabilitiesFor(role: LiveRole): LiveCapabilities {
  return role === 'broadcaster' ? BROADCASTER_CAPABILITIES : VIEWER_CAPABILITIES;
}

/**
 * A session may only be broadcast into while it is starting, live, or
 * recovering from a drop. Handing out a publishing token for an ended session
 * would let a seller resurrect a closed broadcast.
 */
export function canIssueBroadcastCredentials(session: Pick<LiveSession, 'status'>): boolean {
  return (
    session.status === 'scheduled' ||
    session.status === 'starting' ||
    session.status === 'live' ||
    session.status === 'interrupted'
  );
}

/** Viewers may only be admitted to a session that has something to show. */
export function canIssueViewerCredentials(session: Pick<LiveSession, 'status'>): boolean {
  return isWatchable(session);
}

export function assertProductAttached(
  session: Pick<LiveSession, 'id' | 'products'>,
  productId: ProductId,
): void {
  const attached = session.products.some((entry) => entry.productId === productId);
  if (!attached) {
    throw new DomainError('LIVE_PRODUCT_NOT_ATTACHED', 'Product is not part of this session', {
      liveSessionId: session.id,
      productId,
    });
  }
}

export function elapsedSeconds(
  session: Pick<LiveSession, 'startedAt' | 'endedAt'>,
  now: Date = new Date(),
): number {
  if (!session.startedAt) return 0;
  const end = session.endedAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - session.startedAt.getTime()) / 1000));
}

/** Sessions starting within the window are surfaced as "empieza pronto". */
export function isStartingSoon(
  session: Pick<LiveSession, 'status' | 'scheduledAt'>,
  now: Date = new Date(),
  windowMinutes = 60,
): boolean {
  if (session.status !== 'scheduled' || !session.scheduledAt) return false;
  const diffMinutes = (session.scheduledAt.getTime() - now.getTime()) / 60_000;
  return diffMinutes >= 0 && diffMinutes <= windowMinutes;
}

export function sortedLiveProducts(session: Pick<LiveSession, 'products'>): readonly LiveProduct[] {
  return [...session.products].sort((a, b) => a.position - b.position);
}

// --- Chat -------------------------------------------------------------------

export const MESSAGE_KINDS = ['chat', 'system', 'purchase'] as const;
export type LiveMessageKind = (typeof MESSAGE_KINDS)[number];

export interface LiveMessage {
  readonly id: MessageId;
  readonly liveSessionId: LiveSessionId;
  /** Null for system messages. */
  readonly authorId: UserId | null;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly kind: LiveMessageKind;
  readonly body: string;
  readonly createdAt: Date;
}

export const MAX_MESSAGE_LENGTH = 240;

export function sanitizeMessageBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function isMessagePostable(body: string): boolean {
  return sanitizeMessageBody(body).length > 0;
}

/** A viewer tapping the heart. Aggregated, never stored per tap. */
export interface LiveReactionBatch {
  readonly liveSessionId: LiveSessionId;
  readonly count: number;
  readonly at: Date;
}

export interface LiveHighlightChange {
  readonly liveSessionId: LiveSessionId;
  readonly productId: ProductId;
  readonly variantId: VariantId | null;
  readonly at: Date;
}
