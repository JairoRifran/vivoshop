'use client';

import type { LiveMessageDto } from '@vivo/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The application realtime channel.
 *
 * Deliberately separate from the video connection. Chat, presence, hearts and
 * the featured product are ours; they have to keep working when the streaming
 * provider is the mock, when a viewer is on a connection too poor for video,
 * and after we change video vendor. Routing them through the media data
 * channel would also skip the authentication and rate limiting the API does.
 *
 * Everything below is a transport detail. Components consume plain values.
 */

/** Mirrors `REALTIME_EVENTS` in `@vivo/domain`. */
const EVENTS = {
  liveState: 'live.state',
  viewerCount: 'viewer.count',
  chatMessage: 'chat.message',
  reactionBurst: 'reaction.burst',
  productFeatured: 'product.featured',
  orderCreated: 'order.created',
  saleAnnounced: 'sale.announced',
} as const;

const HEARTBEAT_MS = 25_000;

export type LiveConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface LiveStateEvent {
  liveSessionId: string;
  status: string;
  featuredProductId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface OrderCreatedEvent {
  liveSessionId: string;
  orderId: string;
  unitsSold: number;
  ordersCount: number;
  revenueMinor: number;
  currency: string;
  productTitles: string[];
}

export interface SaleAnnouncedEvent {
  liveSessionId: string;
  productTitle: string;
}

export interface RealtimeHandlers {
  onState?: (event: LiveStateEvent) => void;
  onViewerCount?: (count: number) => void;
  onMessage?: (message: LiveMessageDto) => void;
  onReaction?: (event: { count: number; totalLikes: number }) => void;
  onOrder?: (event: OrderCreatedEvent) => void;
  onSale?: (event: SaleAnnouncedEvent) => void;
}

export interface LiveRealtime {
  readonly state: LiveConnectionState;
  sendChat: (body: string) => Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }>;
  sendReaction: (count: number) => void;
}

/**
 * Joins a live room and keeps it joined.
 *
 * `handlers` is read through a ref so a parent re-render never tears the
 * socket down; the effect depends only on the session and the token. That
 * matters more than it looks: reconnecting on every render would reset
 * presence and make the viewer count flicker for everyone in the room.
 */
export function useLiveRealtime(
  liveSessionId: string,
  token: string | null,
  handlers: RealtimeHandlers,
): LiveRealtime {
  const [state, setState] = useState<LiveConnectionState>('connecting');
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  // Updated in an effect rather than during render: writing a ref while
  // rendering is a hazard React can no longer reason about.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    let disposed = false;
    let socket: Socket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    // Dynamic import so the socket client is not in the bundle of pages that
    // never open a live.
    void import('socket.io-client').then(({ io }) => {
      if (disposed) return;

      socket = io(`${API_URL}/realtime`, {
        transports: ['websocket', 'polling'],
        auth: token ? { token } : {},
        // The defaults give up too easily for a phone on mobile data.
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5_000,
      });
      socketRef.current = socket;

      const join = () => {
        socket?.emit('live.join', { liveSessionId });
      };

      socket.on('connect', () => {
        setState('connected');
        join();
      });
      socket.on('disconnect', () => setState('reconnecting'));
      socket.io.on('reconnect_attempt', () => setState('reconnecting'));
      // Repeated failures mean the API is down, not that we are between cells.
      socket.io.on('error', () => setState('offline'));

      socket.on(EVENTS.liveState, (event: LiveStateEvent) => handlersRef.current.onState?.(event));
      socket.on(EVENTS.viewerCount, (event: { viewerCount: number }) =>
        handlersRef.current.onViewerCount?.(event.viewerCount),
      );
      socket.on(EVENTS.chatMessage, (message: LiveMessageDto) =>
        handlersRef.current.onMessage?.(message),
      );
      socket.on(EVENTS.reactionBurst, (event: { count: number; totalLikes: number }) =>
        handlersRef.current.onReaction?.(event),
      );
      socket.on(EVENTS.productFeatured, (event: { productId: string | null }) =>
        handlersRef.current.onState?.({
          liveSessionId,
          status: '',
          featuredProductId: event.productId,
          startedAt: null,
          endedAt: null,
        }),
      );
      socket.on(EVENTS.orderCreated, (event: OrderCreatedEvent) =>
        handlersRef.current.onOrder?.(event),
      );
      socket.on(EVENTS.saleAnnounced, (event: SaleAnnouncedEvent) =>
        handlersRef.current.onSale?.(event),
      );

      // Presence has a TTL on the server so a phone in a tunnel stops counting.
      // This is what keeps an honest long watch from being reaped with it.
      heartbeat = setInterval(() => socket?.emit('live.heartbeat', { liveSessionId }), HEARTBEAT_MS);
    });

    return () => {
      disposed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (socket) {
        socket.emit('live.leave', { liveSessionId });
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [liveSessionId, token]);

  return useMemo<LiveRealtime>(
    () => ({
      state,
      sendChat: (body: string) =>
        new Promise((resolve) => {
          const socket = socketRef.current;
          if (!socket?.connected) {
            resolve({ ok: false, error: 'NETWORK_ERROR' });
            return;
          }
          socket
            .timeout(6_000)
            .emit(
              'chat.send',
              { liveSessionId, body },
              (
                error: unknown,
                response?: { ok: boolean; error?: string; retryAfterSeconds?: number },
              ) => {
                if (error) resolve({ ok: false, error: 'NETWORK_ERROR' });
                else resolve(response ?? { ok: false, error: 'NETWORK_ERROR' });
              },
            );
        }),
      sendReaction: (count: number) => {
        socketRef.current?.emit('reaction.send', { liveSessionId, count });
      },
    }),
    [state, liveSessionId],
  );
}
