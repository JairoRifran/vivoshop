'use client';

import { Button } from '@vivo/ui';
import { useEffect } from 'react';

/**
 * Route-level error boundary. It never shows a stack trace to a buyer: the
 * digest is enough to correlate with server logs, and the copy tells them the
 * one thing they can act on.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[vivo] render error', error);
  }, [error]);

  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-2xl font-extrabold tracking-tight">Algo se rompió de nuestro lado</h1>
      <p className="text-pretty text-[15px] leading-relaxed text-subtle">
        Ya lo registramos. Podés reintentar ahora mismo.
      </p>
      {error.digest ? (
        <p className="text-[12px] text-subtle">
          Referencia: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <Button onClick={reset} className="mt-2">
        Reintentar
      </Button>
    </main>
  );
}
