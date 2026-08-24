'use client';

import { useId, useState } from 'react';

/**
 * El ✓ Tienda Verificada.
 *
 * Dos decisiones que valen más que el componente:
 *
 *  1. **No hay un badge para "no verificada".** Nada dibuja "sin verificar",
 *     ni un ícono gris, ni un tooltip explicando que falta algo. Una tienda
 *     sin tick se ve exactamente como se veía antes de que el tick existiera,
 *     porque la mayoría de los vendedores de VivoShop son particulares y su
 *     tienda no tiene nada de malo.
 *
 *  2. **Se puede tocar y explica qué significa.** Un ✓ sin explicación es un
 *     adorno; con explicación es información. El texto dice exactamente lo que
 *     se comprobó —identidad comercial y datos del negocio— y nada más: no
 *     promete calidad, ni envíos, ni devoluciones.
 */
export function VerifiedBadge({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const box = size === 'sm' ? 'size-4' : 'size-[18px]';

  return (
    <span className={`relative inline-flex shrink-0 items-center ${className ?? ''}`}>
      <button
        type="button"
        aria-label="Tienda verificada por VivoShop"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          // Suele vivir dentro de un enlace a la tienda; tocar el ✓ explica,
          // no navega.
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onBlur={() => setOpen(false)}
        className="grid place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <CheckSeal className={`${box} text-[var(--color-brand)]`} />
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-60 -translate-x-1/2 rounded-2xl bg-ink px-3 py-2.5 text-left text-[12px] leading-relaxed text-bg shadow-card"
        >
          <span className="block font-bold">Tienda verificada por VivoShop</span>
          <span className="block text-bg/85">
            Confirmamos la identidad comercial y los datos del negocio.
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Marca estática, para listas donde no interesa la explicación. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <CheckSeal
      role="img"
      aria-label="Tienda verificada"
      className={`size-4 shrink-0 text-[var(--color-brand)] ${className ?? ''}`}
    />
  );
}

function CheckSeal(props: React.SVGProps<SVGSVGElement> & { role?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden={props.role ? undefined : true} {...props}>
      <path
        d="M12 2.5l2.4 1.9 3-.3 1 2.9 2.6 1.6-1 2.9 1 2.9-2.6 1.6-1 2.9-3-.3L12 21.5l-2.4-1.9-3 .3-1-2.9L3 15.4l1-2.9-1-2.9 2.6-1.6 1-2.9 3 .3L12 2.5z"
        fill="currentColor"
      />
      <path
        d="M8.5 12.2l2.4 2.4 4.6-4.9"
        stroke="var(--color-surface)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
