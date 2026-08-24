import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'live' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

/**
 * Every size clears the 44 px touch target minimum, and `lg` is the default
 * for anything a thumb reaches for on a phone.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-2xl',
  lg: 'h-14 px-6 text-base gap-2.5 rounded-2xl',
};

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ink text-surface hover:bg-ink/90 active:bg-ink/80 shadow-sm shadow-ink/10 disabled:bg-ink/40',
  secondary: 'bg-muted text-ink hover:bg-muted-strong active:bg-muted-strong/80',
  ghost: 'bg-transparent text-ink hover:bg-muted active:bg-muted-strong',
  outline: 'bg-transparent text-ink border border-line hover:bg-muted active:bg-muted-strong',
  live: 'bg-live text-white hover:bg-live/90 active:bg-live/80 shadow-lg shadow-live/25 disabled:bg-live/40',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'lg',
    block = false,
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // `aria-busy` rather than swapping the label keeps the accessible name
      // stable while a request is in flight.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center font-semibold',
        'transition-[background-color,transform,opacity] duration-150 ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'active:scale-[0.985] motion-reduce:active:scale-100 motion-reduce:transition-none',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        SIZES[size],
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="absolute" /> : null}
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cn(
        'size-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80',
        className,
      )}
    />
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'glass' | 'solid' | 'ghost';
  size?: 'md' | 'lg';
}

/** Icon-only control. The visible label is the tooltip and the a11y name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'active:scale-95 motion-reduce:active:scale-100',
        size === 'lg' ? 'size-14' : 'size-11',
        variant === 'glass' && 'bg-black/45 text-white backdrop-blur-md hover:bg-black/60',
        variant === 'solid' && 'bg-ink text-surface hover:bg-ink/90',
        variant === 'ghost' && 'text-ink hover:bg-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
