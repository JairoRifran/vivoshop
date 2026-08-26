'use client';

import { cn } from '@vivo/ui';
import { useCallback } from 'react';
import { SimulatedStage } from './simulated-stage';

/**
 * The video surface, and only the video surface.
 *
 * Everything the buyer interacts with — chat, hearts, the product bar, the
 * store header — is layered over this by the screens that use it. That is the
 * whole reason this is a `<video>` element we control instead of a provider's
 * player component: the experience is ours, and a vendor upgrade must not be
 * able to change how the screen looks.
 *
 * When there is no stream — the mock provider, a session that has not started,
 * one that already ended — it falls back to `SimulatedStage`, which is honest
 * about being a stand-in rather than showing a black rectangle.
 */
export function VideoStage({
  stream,
  fallbackImageUrl,
  muted,
  mirrored = false,
  dimmed = false,
  fallbackLabel,
  className,
}: {
  stream: MediaStream | null;
  fallbackImageUrl: string | null;
  /** Autoplay only survives muted; the viewer screen offers its own control. */
  muted: boolean;
  mirrored?: boolean;
  dimmed?: boolean;
  fallbackLabel?: string;
  className?: string;
}) {
  /**
   * El stream se engancha cuando el elemento aparece, no cuando el stream
   * cambia.
   *
   * Antes esto era un `useEffect` con `[stream]` en las dependencias, y el
   * `<video>` se monta condicionalmente unas líneas más abajo. Los dos hechos
   * juntos dejan un agujero: si React reemplaza el nodo sin que el stream
   * cambie —un remonte del árbol, un refresh de la ruta, cualquier cosa que
   * recree el elemento— el efecto no vuelve a correr, el `<video>` nuevo nace
   * sin `srcObject` y la pantalla queda negra. Para siempre, sin ningún error:
   * el stream sigue vivo, la cámara sigue encendida, la sala sigue publicando.
   * Solo que nadie los conectó.
   *
   * Con un ref callback eso no se puede expresar. El nodo y su stream se atan
   * en el mismo lugar: cuando aparece un elemento se le asigna, y cuando el
   * stream cambia React desengancha y vuelve a enganchar. No hay estado
   * intermedio en el que exista un `<video>` sin fuente.
   */
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      if (!element || !stream) return;
      element.srcObject = stream;
      // Autoplay can still be refused; there is nothing useful to say about it,
      // and the unmute control doubles as the manual start.
      void element.play().catch(() => undefined);

      return () => {
        // Release the reference so the decoder is torn down with the element.
        element.srcObject = null;
      };
    },
    [stream],
  );

  if (!stream) {
    return (
      <SimulatedStage
        imageUrl={fallbackImageUrl}
        muted={dimmed}
        {...(fallbackLabel ? { label: fallbackLabel } : {})}
        {...(className ? { className } : {})}
      />
    );
  }

  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-[#0b0b0f]', className)}>
      <video
        ref={attach}
        muted={muted}
        autoPlay
        playsInline
        // Not `controls`: the native chrome would sit on top of the product bar
        // and break the layout on every browser differently.
        className={cn(
          'size-full object-cover transition-opacity',
          mirrored && 'scale-x-[-1]',
          dimmed && 'opacity-40',
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/45 via-transparent to-black/80"
      />
    </div>
  );
}
