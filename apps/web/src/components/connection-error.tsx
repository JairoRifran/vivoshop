import Link from 'next/link';

/**
 * La API no contestó.
 *
 * No es lo mismo que "no existe" ni que "algo se rompió": el producto está, la
 * tienda está, y en treinta segundos probablemente vuelva. Decirlo así cambia
 * lo que hace la persona — reintenta en vez de irse.
 *
 * Existe porque en producción la API se cae sola cada tanto: un redeploy, un
 * reinicio, un hipo de la base. Sin esto, cada uno de esos momentos le muestra
 * al comprador un error de servidor en crudo.
 */
export function ConnectionError({
  hint = 'Puede ser tu conexión o algo de nuestro lado. Probá de nuevo en unos segundos.',
}: {
  hint?: string;
}) {
  return (
    <main
      id="contenido"
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span aria-hidden className="grid size-14 place-items-center rounded-full bg-muted text-2xl">
        📡
      </span>
      <h1 className="text-2xl font-extrabold tracking-tight">No pudimos conectarnos</h1>
      <p className="text-pretty text-[15px] leading-relaxed text-subtle">{hint}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Link
          href="/"
          className="inline-flex h-13 items-center rounded-2xl bg-ink px-6 text-[15px] font-bold text-surface"
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
