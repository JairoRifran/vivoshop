import { cn } from '@vivo/ui';

/**
 * La marca de VivoShop.
 *
 * ## Qué dibuja, y por qué eso
 *
 * Una bolsa de compras con dos arcos encima: el de adentro es el asa, el de
 * afuera es la señal. Comercio y en vivo en una sola forma, que es exactamente
 * lo que el producto es.
 *
 * El ícono anterior era un triángulo de reproducción dentro de un círculo.
 * Decía "reproductor de video" —igual que otras mil aplicaciones— y no decía
 * ni comercio ni VivoShop.
 *
 * ## El doble arco no es decoración
 *
 * La primera versión tenía un solo arco y **se leía como un candado**: cuerpo
 * sólido más arco encima es la silueta de un candado, y un candado significa
 * bloqueado, que es lo contrario de lo que una tienda quiere decir. Dos arcos
 * concéntricos rompen esa lectura, porque ningún candado tiene doble arco.
 *
 * Lo demás que separa una bolsa de un candado es la tapa: recta y ancha, no
 * redondeada. Por eso el cuerpo arranca con una línea horizontal completa.
 *
 * ## El rojo
 *
 * El arco de afuera usa `--color-live`, el mismo rojo que marca "está pasando
 * ahora" en toda la aplicación. No es un rojo elegido para la marca: es el
 * color de estado, haciendo aquí el mismo trabajo que hace en el resto.
 *
 * `mono` lo apaga y pinta todo con `currentColor`, para el ícono enmascarable
 * de Android —que se recorta a una forma cualquiera— y para cualquier lugar de
 * un solo color.
 */
export function VivoMark({
  className,
  mono = false,
}: {
  readonly className?: string;
  readonly mono?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      focusable="false"
      className={cn('shrink-0', className)}
    >
      {/* La señal. Va primero para que el cuerpo la tape si algo se superpone. */}
      <path
        d="M7.2 14a8.8 8.8 0 0 1 17.6 0"
        stroke={mono ? 'currentColor' : 'var(--color-live)'}
        strokeWidth="2"
        strokeLinecap="round"
        opacity={mono ? 0.55 : 1}
      />
      {/* El asa. */}
      <path
        d="M11.8 14a4.2 4.2 0 0 1 8.4 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* El cuerpo: tapa recta, lados con caída, base redondeada. */}
      <path
        d="M4.4 14H27.6L26.3 24.6C26.05 26.45 24.4 27.8 22.5 27.8H9.5C7.6 27.8 5.95 26.45 5.7 24.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * La marca con el nombre al lado.
 *
 * El nombre es **VivoShop**, y hasta hoy la aplicación decía "Vivo" en todas
 * partes mientras el dominio decía `vivoshop.live`. Un producto con dos
 * nombres no tiene ninguno.
 */
export function VivoWordmark({
  className,
  markClassName,
}: {
  readonly className?: string;
  readonly markClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-brand', className)}>
      <VivoMark className={cn('size-7', markClassName)} />
      <span className="font-extrabold tracking-tight text-ink">VivoShop</span>
    </span>
  );
}
