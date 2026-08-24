import type { LiveDetailDto } from '@vivo/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Direct browser reads for the live surface.
 *
 * M01 polled chat, counters and session state from here on a four-second
 * timer. M02 replaced all of that with the realtime channel in `realtime.ts`,
 * which is where anything live now arrives.
 *
 * What is left is one reconciliation read: after the seller changes the
 * featured product, the console refetches the session so its own view matches
 * what the server persisted, rather than trusting the optimistic update it
 * just made. Everyone else learns about it over the socket.
 */
export async function fetchSession(
  liveSessionId: string,
  signal?: AbortSignal,
): Promise<LiveDetailDto | null> {
  try {
    const response = await fetch(`${API_URL}/live/${liveSessionId}`, {
      signal: signal ?? null,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as LiveDetailDto;
  } catch {
    // A failed reconciliation is not worth surfacing: the socket already
    // delivered the authoritative event.
    return null;
  }
}
