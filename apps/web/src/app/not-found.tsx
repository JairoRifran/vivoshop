import { buttonClasses } from '@vivo/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="text-[13px] font-bold uppercase tracking-widest text-subtle">Error 404</p>
      <h1 className="text-2xl font-extrabold tracking-tight">No encontramos esta página</h1>
      <p className="text-pretty text-[15px] leading-relaxed text-subtle">
        Puede que el vivo haya terminado o que el enlace esté vencido.
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Link
          href="/"
          className={buttonClasses({ className: 'h-13 text-[15px]' })}
        >
          Ir al inicio
        </Link>
        <Link
          href="/en-vivo"
          className="inline-flex h-13 items-center rounded-2xl border border-line bg-surface px-6 text-[15px] font-bold text-ink"
        >
          Ver vivos
        </Link>
      </div>
    </main>
  );
}
