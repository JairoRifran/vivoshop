'use server';

import { revalidatePath } from 'next/cache';
import { api } from '../api';
import { getCurrentUser } from '../api';

/**
 * Follow toggle. Returns the resulting state rather than a bare void so the
 * button can reconcile with the server after an optimistic flip.
 */
export async function toggleFollow(
  storeId: string,
  currentlyFollowing: boolean,
): Promise<{ following: boolean; requiresAuth?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { following: currentlyFollowing, requiresAuth: true };

  const client = await api();
  const result = currentlyFollowing
    ? await client.stores.unfollow(storeId)
    : await client.stores.follow(storeId);

  revalidatePath('/');
  revalidatePath('/explorar');
  return { following: result.following };
}

/**
 * A credential for the WebSocket handshake.
 *
 * The session token is httpOnly and stays that way; this is a separate,
 * short-lived token the browser is allowed to hold, and the REST API rejects
 * it. Anonymous visitors get null and connect as guests, which is deliberate:
 * watching a live must never require an account.
 */
export async function realtimeToken(): Promise<string | null> {
  try {
    const client = await api();
    const { token } = await client.live.realtimeToken();
    return token;
  } catch {
    return null;
  }
}

/** Subscribe-only credential. Null when there is nothing to watch yet. */
export async function viewerCredentials(liveSessionId: string): Promise<unknown | null> {
  try {
    const client = await api();
    const { credentials } = await client.live.viewerToken(liveSessionId);
    return credentials;
  } catch {
    return null;
  }
}
