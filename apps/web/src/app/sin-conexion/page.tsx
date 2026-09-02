import { buttonClasses } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Sin conexión' };

/**
 * Served by the service worker when a navigation fails. It is intentionally
 * static and dependency-free so it can be cached during install.
 */
export default function OfflinePage() {
  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span aria-hidden className="text-5xl">
        📡
      </span>
      <h1 className="text-2xl font-extrabold tracking-tight">Te quedaste sin conexión</h1>
      <p className="text-pretty text-[15px] leading-relaxed text-subtle">
        No pudimos cargar esta pantalla. Los vivos necesitan internet, así que probá de nuevo
        cuando vuelva la señal.
      </p>
      <Link
        href="/"
        className={buttonClasses({ className: 'mt-2 h-13 text-[15px]' })}
      >
        Reintentar
      </Link>
    </main>
  );
}
