'use client';

import { Button } from '@vivo/ui';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { setLiveNotifications } from '@/lib/actions/social';
import { pushPermission, subscribeToPush, type PushPermission } from '@/lib/push';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Dónde se recuerda que alguien ya dijo "ahora no".
 *
 * Por tienda y en el propio navegador: la decisión es de este dispositivo, y
 * guardarla en el servidor la convertiría en una preferencia de la cuenta, que
 * es otra cosa. Volver a ofrecer en cada visita sería exactamente el
 * comportamiento que hace que la gente bloquee los avisos de un sitio.
 */
const dismissedKey = (storeId: string) => `vivo:push-prompt-dismissed:${storeId}`;

function wasDismissed(storeId: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(storeId)) === '1';
  } catch {
    // Modo privado, almacenamiento bloqueado: no poder recordar la respuesta no
    // puede impedir que la pantalla funcione.
    return false;
  }
}

function remember(storeId: string): void {
  try {
    localStorage.setItem(dismissedKey(storeId), '1');
  } catch {
    /* nada que hacer, y nada que romper */
  }
}

/**
 * El permiso y la respuesta previa, leídos del navegador sin efectos.
 *
 * `Notification` y `localStorage` no existen en el servidor, así que el valor
 * depende del entorno. Sincronizarlo con `useState` + `useEffect` funciona pero
 * dispara un render en cascada en cuanto la pantalla se monta —y el compilador
 * de React lo señala con razón—. `useSyncExternalStore` expresa lo que esto es:
 * un valor externo con una lectura distinta en el servidor.
 *
 * No hay suscripción porque no hay evento: el navegador no avisa cuando cambia
 * el permiso. Lo que sí cambia por acción nuestra se lleva en `override`.
 */
const noSubscription = () => () => {};

function useBrowserPush(storeId: string) {
  const detected = useSyncExternalStore<PushPermission>(
    noSubscription,
    () => pushPermission(),
    () => 'unsupported',
  );
  const dismissed = useSyncExternalStore(
    noSubscription,
    () => wasDismissed(storeId),
    () => false,
  );
  const [override, setOverride] = useState<PushPermission | null>(null);

  return { permission: override ?? detected, dismissed, setPermission: setOverride };
}

/**
 * El diálogo propio, después de seguir una tienda.
 *
 * ## Por qué existe en vez de llamar directo al navegador
 *
 * Seguir una tienda y aceptar que te interrumpa son dos decisiones distintas, y
 * el navegador solo pregunta **una vez**. Gastar esa única pregunta en alguien
 * que apenas tocó "Seguir" —sin saber para qué era— es cómo se pierde el
 * permiso para siempre: quien contesta "no" por reflejo ya no puede
 * arrepentirse desde la aplicación.
 *
 * Este diálogo es nuestro, se puede rechazar sin consecuencias, y solo cuando
 * alguien dice que sí se le pasa la pregunta al navegador.
 */
export function LiveNotificationsPrompt({
  storeId,
  storeName,
  onClose,
}: {
  storeId: string;
  storeName: string;
  onClose: () => void;
}) {
  const { permission, dismissed, setPermission } = useBrowserPush(storeId);
  const [pending, setPending] = useState(false);

  const accept = useCallback(async () => {
    setPending(true);
    const result = await subscribeToPush(API_URL);
    setPermission(result);

    if (result === 'granted') {
      await setLiveNotifications(storeId, true);
      onClose();
      return;
    }

    // Rechazado en el diálogo del navegador: se respeta como un "no" y no se
    // vuelve a preguntar. La pantalla lo dice y sigue.
    remember(storeId);
    setPending(false);
  }, [onClose, setPermission, storeId]);

  const decline = useCallback(async () => {
    // Sigue siguiendo la tienda; solo no quiere que le avisen. Y **no** se
    // llama a `requestPermission`: la pregunta del navegador queda intacta para
    // el día que cambie de opinión.
    remember(storeId);
    await setLiveNotifications(storeId, false);
    onClose();
  }, [onClose, storeId]);

  // Nada que ofrecer: sin soporte no se promete algo que no puede pasar.
  if (permission === 'unsupported') return null;
  // Y a quien ya dijo "ahora no" no se le vuelve a preguntar en cada visita.
  // Insistir es cómo un sitio se gana que le bloqueen los avisos.
  if (dismissed && permission !== 'denied') return null;

  if (permission === 'denied') {
    return (
      <p className="rounded-2xl bg-muted px-4 py-3 text-[13px] text-subtle">
        🔕 Las notificaciones están bloqueadas en este dispositivo. Podés
        habilitarlas desde los ajustes del navegador.
      </p>
    );
  }

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card"
    >
      <p className="text-[15px] font-extrabold leading-tight">
        🔔 ¿Querés que te avisemos cuando {storeName} empiece un vivo?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" loading={pending} onClick={() => void accept()} className="flex-1">
          Sí, avisarme
        </Button>
        <Button size="lg" variant="ghost" onClick={() => void decline()} className="flex-1">
          Ahora no
        </Button>
      </div>
    </section>
  );
}

/**
 * El interruptor permanente, en la pantalla de la tienda.
 *
 * Existe porque "ahora no" no puede ser una puerta de una sola dirección. Quien
 * se arrepiente tiene que poder volver sin dejar de seguir la tienda y seguirla
 * de nuevo.
 */
export function LiveNotificationsToggle({
  storeId,
  storeName,
  notifyOnLive,
}: {
  storeId: string;
  storeName: string;
  notifyOnLive: boolean;
}) {
  const { permission, setPermission } = useBrowserPush(storeId);
  const [on, setOn] = useState(notifyOnLive);
  const [pending, setPending] = useState(false);

  if (permission === 'unsupported') return null;

  if (permission === 'denied') {
    return (
      <p className="text-[13px] text-subtle">
        🔕 Notificaciones bloqueadas en este dispositivo.
      </p>
    );
  }

  const toggle = async () => {
    setPending(true);
    const next = !on;
    setOn(next);

    // Encender exige permiso; apagar nunca lo necesita.
    if (next) {
      const result = await subscribeToPush(API_URL);
      setPermission(result);
      if (result !== 'granted') {
        setOn(false);
        setPending(false);
        return;
      }
    }

    await setLiveNotifications(storeId, next);
    setPending(false);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={pending}
      onClick={() => void toggle()}
      className="flex w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-left shadow-card disabled:opacity-60"
    >
      <span className="text-[14px] font-semibold">
        Notificaciones de vivos
        <span className="sr-only"> de {storeName}</span>
      </span>
      <span
        aria-hidden
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          on ? 'bg-brand' : 'bg-line',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-5 rounded-full bg-white transition-all',
            on ? 'left-[22px]' : 'left-0.5',
          ].join(' ')}
        />
      </span>
    </button>
  );
}
