/**
 * The event catalogue is a contract, not a suggestion. Adding an event here is
 * what makes it exist; the transport (console in M01, a real sink later) is
 * swapped behind `AnalyticsSink` without touching a single call site.
 */
export const ANALYTICS_EVENTS = {
  liveOpened: 'live_opened',
  liveViewStarted: 'live_view_started',
  liveViewEnded: 'live_view_ended',
  productViewed: 'product_viewed',
  productSelected: 'product_selected',
  checkoutStarted: 'checkout_started',
  checkoutCompleted: 'checkout_completed',
  storeFollowed: 'store_followed',
  storeUnfollowed: 'store_unfollowed',
  sellerLiveStarted: 'seller_live_started',
  sellerLiveEnded: 'seller_live_ended',
  sellerProductCreated: 'seller_product_created',
  sellerHighlightChanged: 'seller_highlight_changed',
  // --- M02: live infrastructure ---------------------------------------------
  // Deliberately about *outcomes* a product decision can be made from: did the
  // video connect, how long did it take, why did someone leave. None of these
  // carry a token, a room name or a provider secret.
  liveJoinAttempted: 'live_join_attempted',
  liveVideoConnected: 'live_video_connected',
  liveVideoFailed: 'live_video_failed',
  liveReconnected: 'live_reconnected',
  liveChatSent: 'live_chat_sent',
  liveReactionSent: 'live_reaction_sent',
  liveShared: 'live_shared',
  broadcastPermissionDenied: 'broadcast_permission_denied',
  broadcastPublishStarted: 'broadcast_publish_started',
  broadcastQualityDegraded: 'broadcast_quality_degraded',
  signUpCompleted: 'sign_up_completed',
  signInCompleted: 'sign_in_completed',
  sellerModeActivated: 'seller_mode_activated',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Property shapes per event, so a typo in a property name fails to compile. */
export interface AnalyticsEventProperties {
  live_opened: { liveSessionId: string; storeId: string; source: 'home' | 'explore' | 'store' | 'direct' };
  live_view_started: { liveSessionId: string; storeId: string };
  live_view_ended: { liveSessionId: string; watchedSeconds: number };
  product_viewed: { productId: string; storeId: string; liveSessionId?: string };
  product_selected: { productId: string; variantId: string; liveSessionId?: string };
  checkout_started: { productId: string; variantId: string; totalMinor: number; currency: string };
  checkout_completed: { orderId: string; totalMinor: number; currency: string; liveSessionId?: string };
  store_followed: { storeId: string };
  store_unfollowed: { storeId: string };
  seller_live_started: { liveSessionId: string; storeId: string; productCount: number };
  seller_live_ended: { liveSessionId: string; elapsedSeconds: number; unitsSold: number };
  seller_product_created: { productId: string; storeId: string };
  seller_highlight_changed: { liveSessionId: string; productId: string | null };
  sign_up_completed: { userId: string };
  sign_in_completed: { userId: string };
  seller_mode_activated: { userId: string; storeId: string };

  live_join_attempted: { liveSessionId: string; role: 'viewer' | 'broadcaster' };
  live_video_connected: { liveSessionId: string; provider: string; msToFirstFrame: number };
  live_video_failed: { liveSessionId: string; provider: string; reason: string };
  live_reconnected: { liveSessionId: string; downSeconds: number };
  live_chat_sent: { liveSessionId: string; rateLimited: boolean };
  live_reaction_sent: { liveSessionId: string; count: number };
  live_shared: { liveSessionId: string; method: 'share_sheet' | 'clipboard' };
  broadcast_permission_denied: { liveSessionId: string; fault: string };
  broadcast_publish_started: { liveSessionId: string; provider: string; facing: 'user' | 'environment' };
  broadcast_quality_degraded: { liveSessionId: string; quality: string };
}

export interface AnalyticsEvent<N extends AnalyticsEventName = AnalyticsEventName> {
  readonly name: N;
  readonly properties: N extends keyof AnalyticsEventProperties
    ? AnalyticsEventProperties[N]
    : Record<string, unknown>;
  readonly occurredAt: string;
}

export interface AnalyticsSink {
  track(event: AnalyticsEvent): void | Promise<void>;
}

/** Drops everything. Used in tests and during server rendering. */
export const noopAnalyticsSink: AnalyticsSink = {
  track() {
    /* intentionally empty */
  },
};

export function createConsoleAnalyticsSink(prefix = 'analytics'): AnalyticsSink {
  return {
    track(event) {
      console.warn(`[${prefix}] ${event.name}`, event.properties);
    },
  };
}

export function buildEvent<N extends AnalyticsEventName>(
  name: N,
  properties: AnalyticsEvent<N>['properties'],
  occurredAt: Date = new Date(),
): AnalyticsEvent<N> {
  return { name, properties, occurredAt: occurredAt.toISOString() };
}
