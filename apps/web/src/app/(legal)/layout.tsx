import Link from 'next/link';
import type { ReactNode } from 'react';
import { VivoWordmark } from '@/components/brand';

/**
 * Las páginas legales.
 *
 * Layout propio y no el de comprador, por dos razones. La primera es que a
 * estas páginas se llega **desde afuera**: el enlace vive en la pantalla de
 * consentimiento de Google, así que quien las abre puede no tener cuenta y no
 * haber visto nunca la aplicación. Una barra de navegación con "Compras" y
 * "Perfil" abajo sería ruido para esa persona.
 *
 * La segunda es que son documentos, no pantallas. Una sola columna angosta,
 * medida para leer, sin nada fijo que tape el texto.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[46rem] flex-col px-5 pt-safe">
      <header className="flex items-center justify-between gap-3 py-4">
        <Link
          href="/"
          className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <VivoWordmark className="text-[17px]" markClassName="size-6" />
        </Link>
        <nav className="flex items-center gap-4 text-[13px] font-semibold text-subtle">
          <Link href="/privacidad" className="hover:text-ink">
            Privacidad
          </Link>
          <Link href="/terminos" className="hover:text-ink">
            Términos
          </Link>
        </nav>
      </header>

      <main
        id="contenido"
        /*
         * `[&_p]` y compañía en vez de una clase por etiqueta: son dos
         * documentos largos de prosa, y etiquetar cada párrafo a mano se
         * desincroniza entre los dos apenas alguien edita uno.
         */
        className="flex-1 pb-16 text-[15px] leading-relaxed text-ink-soft
          [&_a]:font-semibold [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2
          [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-[20px] [&_h2]:font-extrabold [&_h2]:text-ink
          [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-[16px] [&_h3]:font-bold [&_h3]:text-ink
          [&_li]:mb-1.5 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-4 [&_strong]:text-ink
          [&_ul]:mb-4"
      >
        {children}
      </main>

      <footer className="border-t border-line py-6 text-[13px] text-subtle">
        <p>
          VivoShop · Ventas en vivo en Uruguay ·{' '}
          <a
            href="mailto:hola@vivoshop.live"
            className="font-semibold text-brand underline underline-offset-2"
          >
            hola@vivoshop.live
          </a>
        </p>
      </footer>
    </div>
  );
}
