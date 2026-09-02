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

const BASE = [
  'relative inline-flex select-none items-center justify-center font-semibold',
  'transition-[background-color,transform,opacity] duration-150 ease-out',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  'active:scale-[0.985] motion-reduce:active:scale-100 motion-reduce:transition-none',
  'disabled:cursor-not-allowed disabled:active:scale-100',
].join(' ');

const VARIANTS: Record<Variant, string> = {
  /*
   * El primario es el verde de la marca y no el negro que era antes.
   *
   * Un primario negro es elegante y no es de nadie: deja el color de la marca
   * fuera de lo único que la persona toca. Con el verde, cada acción que
   * importa lleva la marca encima, que es lo que hace que un producto se
   * reconozca sin leer el nombre.
   *
   * El negro no desapareció: sigue siendo el fondo de las tarjetas oscuras,
   * donde hace de superficie y no de acción.
   */
  primary:
    'bg-brand text-white hover:bg-brand-ink active:bg-brand-ink shadow-sm shadow-brand/20 disabled:bg-brand/40',
  secondary: 'bg-muted text-ink hover:bg-muted-strong active:bg-muted-strong/80',
  ghost: 'bg-transparent text-ink hover:bg-muted active:bg-muted-strong',
  outline: 'bg-transparent text-ink border border-line hover:bg-muted active:bg-muted-strong',
  live: 'bg-live text-white hover:bg-live/90 active:bg-live/80 shadow-lg shadow-live/25 disabled:bg-live/40',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
};

/**
 * Las clases de un botón, sin el botón.
 *
 * Existe porque media aplicación no usaba `<Button>`: había una decena de
 * enlaces con `inline-flex h-13 ... bg-ink ... text-surface` escrito a mano,
 * cada uno una copia del primario. Mientras el primario fue negro no se notó;
 * al darle color a la marca, quedó a la vista que el estilo del botón vivía en
 * diez archivos y no en uno.
 *
 * Un enlace no puede ser un `<button>` —navega, no ejecuta— así que no
 * alcanzaba con reemplazarlos por el componente. Lo que se comparte es esto.
 */
export function buttonClasses(options?: {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
}): string {
  const { variant = 'primary', size = 'lg', block = false, className } = options ?? {};
  return cn(
    BASE,
    SIZES[size],
    VARIANTS[variant],
    block && 'w-full',
    className,
  );
}

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
      className={buttonClasses({ variant, size, block, className })}
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
        variant === 'solid' && 'bg-brand text-white hover:bg-brand-ink',
        variant === 'ghost' && 'text-ink hover:bg-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
