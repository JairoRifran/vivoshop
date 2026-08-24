import { cn } from '@vivo/ui';

/**
 * Stand-in for the video feed.
 *
 * M01 ships no streaming, and a black rectangle would make every live screen
 * look broken during review. This renders the session artwork with a slow
 * drift and a grain pass so the screen reads as a camera feed, and labels
 * itself honestly rather than pretending.
 *
 * When `StreamingProvider` returns a real `playbackUrl`, the player element
 * replaces this component and everything layered on top of it — chat, hearts,
 * the product bar — stays exactly where it is.
 */
export function SimulatedStage({
  imageUrl,
  label = 'Video simulado',
  className,
  muted = false,
}: {
  imageUrl: string | null;
  label?: string;
  className?: string;
  muted?: boolean;
}) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-[#0b0b0f]', className)}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className={cn(
            'size-full scale-110 object-cover',
            'animate-[stage-drift_28s_ease-in-out_infinite_alternate]',
            'motion-reduce:animate-none motion-reduce:scale-105',
            muted && 'opacity-60',
          )}
        />
      ) : null}

      {/* Grain: a single inline SVG turbulence, no asset request. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        }}
      />

      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-b from-black/55 via-black/10 to-black/85"
      />

      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/60 backdrop-blur-sm">
        {label}
      </span>

      <style>{`
        @keyframes stage-drift {
          from { transform: scale(1.10) translate3d(-1.5%, -1%, 0); }
          to   { transform: scale(1.18) translate3d(1.5%, 1.5%, 0); }
        }
      `}</style>
    </div>
  );
}
