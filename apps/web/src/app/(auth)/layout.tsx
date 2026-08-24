import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeftIcon } from '@/components/icons';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-canvas px-5 pt-safe">
      <header className="flex items-center gap-2 py-3">
        <Link
          href="/"
          aria-label="Volver al inicio"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <span className="text-[15px] font-extrabold tracking-tight">Vivo</span>
      </header>
      <main id="contenido" className="flex flex-1 flex-col justify-center pb-10">
        {children}
      </main>
    </div>
  );
}
