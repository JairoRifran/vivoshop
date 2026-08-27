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
 * Registra este navegador para recibir avisos.
 *
 * Va por el servidor y no por un `fetch` del navegador a la API, y la razón es
 * concreta: la sesión vive en una cookie del dominio de la web, no del de la
 * API. Un `fetch` con `credentials: 'include'` cruzando orígenes se choca con
 * CORS y, aunque no lo hiciera, no llevaría la sesión. El resto de la
 * aplicación ya funciona así.
 *
 * Lo que el navegador aporta es lo único que solo él puede dar: el `endpoint`
 * que le asignó su servicio de push y las claves con las que descifra.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  try {
    const client = await api();
    await client.notifications.subscribe(input);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Enciende o apaga el aviso de vivos de una tienda.
 *
 * **No** revalida `/transmitir`: esa pantalla sostiene el `MediaStream` de la
 * cámara y una sala de LiveKit publicando, y refrescarla al aire deja al
 * vendedor en negro. Costó encontrarlo una vez —ver `m04.md` §17.1— y no vale
 * la pena repetirlo por un interruptor.
 */
export async function setLiveNotifications(
  storeId: string,
  notifyOnLive: boolean,
): Promise<{ notifyOnLive: boolean; requiresAuth?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { notifyOnLive: false, requiresAuth: true };

  try {
    const client = await api();
    return await client.stores.setLiveNotifications(storeId, notifyOnLive);
  } catch {
    // Un interruptor que falla no puede romper la pantalla: se devuelve el
    // estado pedido y la próxima carga muestra la verdad del servidor.
    return { notifyOnLive };
  }
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
