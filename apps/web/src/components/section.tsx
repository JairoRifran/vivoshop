import { Skeleton, cn } from '@vivo/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRightIcon } from './icons';

export function Section({
  title,
  subtitle,
  href,
  hrefLabel = 'Ver todo',
  children,
  className,
  contentClassName,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <header className="flex items-end justify-between gap-3 px-4">
        <div className="min-w-0">
          <h2 className="text-[19px] font-extrabold tracking-tight">{title}</h2>
          {subtitle ? <p className="text-[13px] text-subtle">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {hrefLabel}
            <ChevronRightIcon className="size-4" />
          </Link>
        ) : null}
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

/**
 * Horizontal rail with scroll snapping. The trailing spacer is what makes the
 * last card clear the screen edge instead of sitting flush against it.
 */
export function Rail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1',
        '[&>*]:snap-start',
        className,
      )}
    >
      {children}
      <span aria-hidden className="w-1 shrink-0" />
    </div>
  );
}

export function RailSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className="no-scrollbar flex gap-3 overflow-hidden px-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={cn('aspect-9/16 w-[168px] shrink-0 rounded-3xl', className)} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-4/5 rounded-2xl" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}
