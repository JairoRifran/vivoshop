import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Loading placeholder. Skeletons mirror the shape of the content they replace,
 * so the layout does not jump when data lands — the single biggest source of
 * "cheap" feel on a slow connection.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-xl bg-muted-strong/70 motion-reduce:animate-none',
        className,
      )}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Empty is a designed state, not an accident: it always offers a way out. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-3xl bg-muted/60 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-subtle">{icon}</div> : null}
      <h3 className="text-balance text-lg font-bold tracking-tight text-ink">{title}</h3>
      {description ? (
        <p className="max-w-sm text-pretty text-[15px] leading-relaxed text-subtle">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = 'No pudimos cargar esto',
  description = 'Revisá tu conexión y volvé a intentar.',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-3xl border border-danger/20 bg-danger/5 px-6 py-10 text-center',
        className,
      )}
    >
      <h3 className="text-lg font-bold tracking-tight text-ink">{title}</h3>
      <p className="max-w-sm text-pretty text-[15px] leading-relaxed text-subtle">{description}</p>
      {action}
    </div>
  );
}

type BadgeTone = 'neutral' | 'live' | 'success' | 'warning' | 'info' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted-strong text-ink',
  live: 'bg-live text-white',
  success: 'bg-success/12 text-success-ink',
  warning: 'bg-warning/15 text-warning-ink',
  info: 'bg-info/12 text-info-ink',
  danger: 'bg-danger/10 text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold leading-none tracking-wide',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The pulsing dot that means "this is happening right now". */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex size-2', className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-70 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted-strong text-xs font-bold text-ink',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // Plain <img>: these are tiny generated SVGs, so Next's optimizer would
        // add a round trip without saving any bytes.
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
