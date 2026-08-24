'use client';

import { cn } from '@vivo/ui';
import { useEffect, useRef } from 'react';
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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !stream) return;

    element.srcObject = stream;
    // Autoplay can still be refused; there is nothing useful to say about it,
    // and the unmute control doubles as the manual start.
    void element.play().catch(() => undefined);

    return () => {
      // Release the reference on unmount so the decoder is torn down with it.
      element.srcObject = null;
    };
  }, [stream]);

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
        ref={videoRef}
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
