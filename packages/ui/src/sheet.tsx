'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from './cn';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Hides the visible header but keeps an accessible name. */
  hideTitle?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Bottom sheet built on the native `<dialog>` element.
 *
 * Using the platform primitive means the focus trap, the ESC handler, inert
 * background content and the top layer come from the browser rather than from
 * a few hundred lines of our own that would get them subtly wrong.
 */
export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  footer,
  className,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Locks background scroll while the sheet is up, restoring whatever the page
  // had before rather than assuming it was scrollable.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      // A click that lands on the dialog element itself is a backdrop click:
      // the panel inside stops propagation of its own clicks.
      if (event.target === ref.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={handleBackdropClick}
      aria-label={hideTitle ? title : undefined}
      className={cn(
        'vivo-sheet m-0 w-full max-w-none bg-transparent p-0 text-ink',
        'mt-auto max-h-[92dvh] sm:m-auto sm:max-w-lg',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
      )}
    >
      <div
        className={cn(
          'flex max-h-[92dvh] flex-col rounded-t-3xl bg-surface sm:rounded-3xl',
          'pb-[max(1rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-3">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line" />
          {title && !hideTitle ? (
            <h2 className="pt-3 text-lg font-bold tracking-tight">{title}</h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="mt-3 inline-flex size-9 items-center justify-center rounded-full text-subtle transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-line bg-surface px-5 pt-3">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
