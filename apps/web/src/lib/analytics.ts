'use client';

import {
  buildEvent,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '@vivo/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Client-side analytics.
 *
 * Two properties matter more than where events end up: delivery never blocks
 * the interaction that produced it, and a failure to report is never a failure
 * the buyer can see.
 *
 * `fetch` with `keepalive` rather than `sendBeacon`: a beacon carrying
 * `application/json` needs a CORS preflight it cannot perform, so cross-origin
 * events were being dropped silently. `keepalive` survives the page closing
 * just the same, and obeys CORS properly.
 */
export function track<N extends AnalyticsEventName>(
  name: N,
  properties: AnalyticsEvent<N>['properties'],
): void {
  if (typeof window === 'undefined') return;

  const event = buildEvent(name, properties);
  const payload = JSON.stringify({
    name: event.name,
    properties: event.properties,
    occurredAt: event.occurredAt,
  });
  const url = `${API_URL}/analytics/events`;

  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    // Analytics must never break a purchase.
  }
}
