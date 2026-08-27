/**
 * Suscribir este navegador a los avisos, y saber cuándo ni ofrecerlo.
 *
 * ## Los cuatro estados, y por qué importan los cuatro
 *
 * - `unsupported` — el navegador no tiene push. No se muestra ningún control
 *   que prometa algo que no puede pasar. Seguir la tienda sigue funcionando
 *   igual: son dos cosas distintas.
 * - `default` — nadie decidió todavía. Es el único estado en el que se puede
 *   ofrecer.
 * - `granted` — hay permiso; queda registrar el dispositivo.
 * - `denied` — la persona dijo que no. **No se vuelve a pedir.** El navegador
 *   ignora `requestPermission()` después de un rechazo, así que insistir no
 *   consigue nada y además gasta la confianza de quien ya contestó.
 */
import { savePushSubscription } from './actions/social';

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/**
 * Si este navegador puede recibir avisos.
 *
 * Las tres comprobaciones existen por separado porque fallan por separado: hay
 * navegadores con `serviceWorker` y sin `PushManager`, y PWAs donde
 * `Notification` no está aunque el resto sí. Asumir que una implica las otras
 * es cómo aparece un `undefined is not a function` en el teléfono de alguien.
 */
export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  );
}

export function pushPermission(): PushPermission {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as Exclude<PushPermission, 'unsupported'>;
}

/** La clave pública VAPID, o `null` si el servidor no tiene avisos configurados. */
export async function fetchPublicKey(apiUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/notifications/public-key`);
    if (!response.ok) return null;
    const body = (await response.json()) as { publicKey: string | null };
    return body.publicKey;
  } catch {
    // Sin clave no hay avisos, y eso no es un error que valga interrumpir a
    // nadie: la pantalla simplemente no ofrece el control.
    return null;
  }
}

/**
 * `PushManager` quiere los bytes crudos de la clave, no su base64url.
 *
 * La conversión va acá y no en el componente porque es un detalle del
 * transporte, y porque equivocarla produce un error opaco del navegador que no
 * dice nada sobre qué se hizo mal.
 */
function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Respaldado por un `ArrayBuffer` propio: `PushManager` exige un
  // `BufferSource` y no acepta una vista sobre memoria compartida.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length)) as Uint8Array<ArrayBuffer>;
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * Pide permiso y registra este dispositivo.
 *
 * Solo se llama cuando la persona tocó "Sí, avisarme" en el diálogo propio. Es
 * la regla que más cuida el permiso: el navegador solo pregunta una vez, y
 * gastarlo en alguien que apenas tocó "Seguir" —sin saber para qué— es cómo se
 * pierde para siempre.
 */
export async function subscribeToPush(apiUrl: string): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  const publicKey = await fetchPublicKey(apiUrl);
  if (!publicKey) return 'unsupported';

  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushPermission;

  const registration = await navigator.serviceWorker.ready;
  // `getSubscription` primero: el navegador devuelve la misma si ya existe, y
  // volver a suscribirse con otra clave la invalidaría sin avisar.
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Obligatorio en todos los navegadores actuales: prohíbe los avisos
      // silenciosos, que es lo que hace que el permiso valga algo.
      userVisibleOnly: true,
      applicationServerKey: decodeKey(publicKey),
    }));

  const raw = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) return 'denied';

  const saved = await savePushSubscription({
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
    userAgent: navigator.userAgent,
  });

  // Sin sesión no hay a quién asociarle el destino. Se devuelve `default` para
  // que la pantalla no muestre el aviso como encendido: el permiso del
  // navegador quedó dado, pero el registro no ocurrió.
  return saved.ok ? 'granted' : 'default';
}
