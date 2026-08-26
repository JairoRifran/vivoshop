'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';

/**
 * The browser side of the streaming seam.
 *
 * `livekit-client` is imported dynamically in every path here, so the WebRTC
 * SDK — around 200 KB gzipped — never lands in the bundle of the home page,
 * the catalogue or checkout. It is fetched the moment someone actually opens a
 * broadcast or a player, and not before.
 *
 * Nothing above these hooks knows the vendor. They speak in "preview",
 * "publish", "quality", and hand back a `MediaStream` or a `Room`.
 */

export interface StreamCredentials {
  url: string;
  token: string;
  identity: string;
  expiresAt: string;
  canPublish: boolean;
}

/**
 * Opciones de la sala del **comprador**.
 *
 * `adaptiveStream` va apagado, y no es un descuido — es la corrección de un
 * error que estuvo en producción.
 *
 * LiveKit decide si alguien está mirando observando **los elementos que él
 * mismo adjuntó** con `track.attach()`. `useViewerStream` no hace eso: saca el
 * `MediaStreamTrack` de cada pista y arma su propio `MediaStream`, que
 * `VideoStage` asigna a `srcObject`. Desde donde LiveKit mira no hay ningún
 * elemento adjunto, así que concluye que nadie está viendo y —en sus propias
 * palabras— "temporarily pause the data flow until they are visible again".
 *
 * El síntoma era exactamente ese: el video andaba unos segundos y se quedaba
 * en negro, con la conexión viva y el vivo abierto. De los peores errores
 * posibles, porque no falla nada: sin excepción, sin desconexión, sin una
 * línea en la consola. Solo deja de haber imagen.
 *
 * Se apaga en vez de adjuntar la pista porque adjuntar significaría que el
 * hook maneje el `<video>`, y su contrato hoy es "devolvé un MediaStream" — el
 * mismo que cumple el proveedor simulado. Recuperar la optimización está
 * anotado como deuda; lo que se pierde es poco, porque la pantalla del
 * comprador es prácticamente siempre el video a pantalla completa.
 */
export const VIEWER_ROOM_OPTIONS = { adaptiveStream: false } as const;

/**
 * Opciones de la sala del **vendedor**.
 *
 * `dynacast` se queda encendido: pausa las capas que ningún espectador
 * consume, y eso es ahorro real de batería y de datos en un teléfono que
 * transmite. Con la sala del comprador arreglada, los espectadores vuelven a
 * pedir la pista y dynacast publica.
 *
 * `adaptiveStream` se sacó de acá porque no hacía nada: es una opción de quien
 * se suscribe, y esta sala no se suscribe a nada — el vendedor es el único que
 * publica. Configuración muerta que solo invitaba a copiarla al otro lado.
 */
export const BROADCASTER_ROOM_OPTIONS = { dynacast: true } as const;

/** Plain-language connection quality. Never milliseconds, never percentages. */
export type ConnectionLabel = 'buena' | 'regular' | 'inestable' | 'sin-conexion';

export const CONNECTION_COPY: Record<ConnectionLabel, string> = {
  buena: 'Conexión estable',
  regular: 'Conexión justa',
  inestable: 'Conexión inestable',
  'sin-conexion': 'Sin conexión',
};

/**
 * Why a camera request failed, in terms the UI can act on.
 *
 * The distinction matters: "denied" needs instructions for the browser's
 * permission menu, "not-found" needs a different device, and "in-use" usually
 * means another app has the camera. A single "error" would leave the seller
 * stuck with no idea what to do.
 */
export type MediaFault = 'denied' | 'not-found' | 'in-use' | 'insecure' | 'unsupported' | 'unknown';

export const MEDIA_FAULT_COPY: Record<MediaFault, { title: string; hint: string }> = {
  denied: {
    title: 'Necesitamos permiso para usar la cámara',
    hint: 'Tocá el candado en la barra del navegador y permití cámara y micrófono.',
  },
  'not-found': {
    title: 'No encontramos una cámara',
    hint: 'Conectá una cámara o probá desde el teléfono.',
  },
  'in-use': {
    title: 'La cámara está ocupada',
    hint: 'Cerrá otras apps que la estén usando y volvé a intentar.',
  },
  insecure: {
    title: 'Necesitás una conexión segura',
    hint: 'El navegador solo permite la cámara en https o en localhost.',
  },
  unsupported: {
    title: 'Este navegador no puede transmitir',
    hint: 'Probá con Chrome o Safari actualizados.',
  },
  unknown: {
    title: 'No pudimos encender la cámara',
    hint: 'Volvé a intentar en unos segundos.',
  },
};

export function classifyMediaError(error: unknown): MediaFault {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'unsupported';
  }
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not-found';
  if (name === 'NotReadableError' || name === 'AbortError') return 'in-use';
  return 'unknown';
}

export type Facing = 'user' | 'environment';

export interface BroadcastState {
  readonly stream: MediaStream | null;
  readonly fault: MediaFault | null;
  readonly publishing: boolean;
  readonly quality: ConnectionLabel;
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  readonly facing: Facing;
  toggleMic: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  retry: () => void;
}

/**
 * Local camera plus, when there is somewhere to send it, a publishing room.
 *
 * The preview is always the real local camera, even when the streaming
 * provider is the mock: a seller checking their framing should see themselves,
 * not a placeholder. Publishing is what depends on having credentials.
 */
export function useBroadcast(
  credentials: StreamCredentials | null,
  enabled: boolean,
): BroadcastState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fault, setFault] = useState<MediaFault | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [quality, setQuality] = useState<ConnectionLabel>('buena');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [facing, setFacing] = useState<Facing>('environment');
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- Local camera ---------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const open = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');

        const next = await navigator.mediaDevices.getUserMedia({
          // `facingMode` rather than a device id: on a phone the id changes
          // between sessions, and "the back camera" is what the seller means.
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });

        if (cancelled) {
          for (const track of next.getTracks()) track.stop();
          return;
        }

        // Stop the previous stream only once the new one exists, so switching
        // cameras never leaves a black rectangle if the request fails.
        const previous = streamRef.current;
        streamRef.current = next;
        setStream(next);
        setFault(null);
        for (const track of previous?.getTracks() ?? []) track.stop();
      } catch (error) {
        if (!cancelled) setFault(classifyMediaError(error));
      }
    };

    void open();
    return () => {
      cancelled = true;
    };
  }, [enabled, facing, attempt]);

  // Tracks are stopped on unmount, not just dropped: a camera light left on
  // after leaving the page is the most alarming bug this screen could have.
  useEffect(() => {
    return () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, []);

  // --- Publishing -----------------------------------------------------------

  useEffect(() => {
    if (!enabled || !credentials?.url || !credentials.canPublish || !stream) return;
    let cancelled = false;
    let room: Room | null = null;

    const publish = async () => {
      const livekit = await import('livekit-client');
      if (cancelled) return;

      room = new livekit.Room(BROADCASTER_ROOM_OPTIONS);
      roomRef.current = room;

      room.on(livekit.RoomEvent.ConnectionQualityChanged, (value, participant) => {
        if (participant?.identity !== credentials.identity) return;
        setQuality(toLabel(value));
      });
      room.on(livekit.RoomEvent.Reconnecting, () => setQuality('inestable'));
      room.on(livekit.RoomEvent.Reconnected, () => setQuality('regular'));
      room.on(livekit.RoomEvent.Disconnected, () => {
        setPublishing(false);
        setQuality('sin-conexion');
      });

      try {
        await room.connect(credentials.url, credentials.token);
        if (cancelled) return;

        for (const track of stream.getTracks()) {
          await room.localParticipant.publishTrack(track);
        }
        setPublishing(true);
      } catch {
        // The console shows this as "no pudimos conectar el video"; the local
        // preview keeps working so the seller is not staring at a black box.
        if (!cancelled) {
          setPublishing(false);
          setQuality('sin-conexion');
        }
      }
    };

    void publish();

    return () => {
      cancelled = true;
      void room?.disconnect();
      roomRef.current = null;
      setPublishing(false);
    };
  }, [enabled, credentials, stream]);

  // --- Controls -------------------------------------------------------------

  const toggleMic = useCallback(() => {
    setMicOn((current) => {
      const next = !current;
      for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = next;
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOn((current) => {
      const next = !current;
      for (const track of streamRef.current?.getVideoTracks() ?? []) track.enabled = next;
      return next;
    });
  }, []);

  const switchCamera = useCallback(() => {
    setFacing((current) => (current === 'user' ? 'environment' : 'user'));
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    stream,
    fault,
    publishing,
    quality,
    micOn,
    cameraOn,
    facing,
    toggleMic,
    toggleCamera,
    switchCamera,
    retry,
  };
}

export interface ViewerStreamState {
  readonly stream: MediaStream | null;
  readonly connecting: boolean;
  readonly failed: boolean;
}

/**
 * Subscribes to the broadcaster's tracks and hands back a plain `MediaStream`.
 *
 * A `MediaStream` on purpose, rather than the provider's own player component:
 * the viewer screen is ours — chat, hearts, the product bar, the safe-area
 * layout — and dropping a vendor player into it would replace a designed
 * experience with a generic one.
 */
export function useViewerStream(credentials: StreamCredentials | null): ViewerStreamState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!credentials?.url) return;
    let cancelled = false;
    let room: Room | null = null;

    const watch = async () => {
      setConnecting(true);
      setFailed(false);

      const livekit = await import('livekit-client');
      if (cancelled) return;

      room = new livekit.Room(VIEWER_ROOM_OPTIONS);

      const media = new MediaStream();
      const sync = () => {
        if (!cancelled) setStream(media.getTracks().length > 0 ? media : null);
      };

      room.on(livekit.RoomEvent.TrackSubscribed, (track) => {
        media.addTrack(track.mediaStreamTrack);
        sync();
      });
      room.on(livekit.RoomEvent.TrackUnsubscribed, (track) => {
        media.removeTrack(track.mediaStreamTrack);
        sync();
      });

      try {
        await room.connect(credentials.url, credentials.token);
        if (!cancelled) setConnecting(false);
      } catch {
        if (!cancelled) {
          setConnecting(false);
          setFailed(true);
        }
      }
    };

    void watch();

    return () => {
      cancelled = true;
      void room?.disconnect();
      setStream(null);
    };
  }, [credentials]);

  return { stream, connecting, failed };
}

/**
 * Keeps the screen awake while broadcasting.
 *
 * A seller holding the phone at a product is not touching the screen, and a
 * display that sleeps mid-sale ends the broadcast for everyone watching. The
 * API is not available everywhere, so every call is guarded and a missing
 * Wake Lock is simply a screen that dims — never an error.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    type WakeLockSentinel = { release: () => Promise<void> };
    const api = (
      navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
      }
    ).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        const next = await api.request('screen');
        if (released) void next.release();
        else sentinel = next;
      } catch {
        // Denied or unsupported. The screen dims; nothing else changes.
      }
    };

    // The lock is dropped whenever the tab is hidden, so it has to be retaken
    // when the seller comes back from answering a message.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [active]);
}

function toLabel(quality: unknown): ConnectionLabel {
  switch (String(quality)) {
    case 'excellent':
      return 'buena';
    case 'good':
      return 'regular';
    case 'poor':
      return 'inestable';
    case 'lost':
      return 'sin-conexion';
    default:
      return 'buena';
  }
}
