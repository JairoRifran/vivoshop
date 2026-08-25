'use client';

import type { BidSessionDto } from '@vivo/shared';
import { Badge, Button, Sheet } from '@vivo/ui';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { placeBid } from '@/lib/actions/bids';
import { money } from '@/lib/format';

/**
 * Modo Puja, del lado de quien mira.
 *
 * Tres cosas gobiernan esta pantalla:
 *
 *  - **La referencia se muestra pero no manda.** Es lo que decía la ficha; el
 *    vendedor puede aceptar por debajo. Ponerla como si fuera un piso haría
 *    que nadie oferte menos, que es justo lo contrario de para qué existe.
 *  - **El mínimo siguiente lo calcula el servidor.** Llega en el DTO. Si el
 *    navegador lo recalculara, sería una segunda implementación de la regla, y
 *    la que se equivocaría no sería la del servidor.
 *  - **Ofertar exige cuenta.** Mirar, no. Una oferta anónima no se puede
 *    honrar: si el vendedor la acepta, tiene que haber a quién reservarle.
 */
export function BidPanel({
  session,
  isSignedIn,
  onRefresh,
}: {
  session: BidSessionDto;
  isSignedIn: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * `null` significa "todavía no lo tocó".
   *
   * El campo arranca con el mínimo sugerido y lo sigue mientras nadie escriba.
   * Se deriva en vez de copiarse con un efecto: sincronizar estado con props
   * desde un `useEffect` genera un render en cascada —y el compilador de React
   * lo señala— además de pisar lo que la persona esté escribiendo si llega una
   * oferta mientras tanto.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const leader = session.leadingBid;
  const isMine = Boolean(session.viewerBid && leader && session.viewerBid.id === leader.id);
  const won = session.viewerBid?.outcome === 'accepted';

  // El mínimo sugerido, ya en unidades mayores para escribir en el campo.
  const suggested = useMemo(
    () => Math.ceil(session.nextMinimumMinor / 100).toString(),
    [session.nextMinimumMinor],
  );
  const amount = typed ?? suggested;

  const submit = () => {
    const amountMinor = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError('Escribí cuánto querés ofertar.');
      return;
    }
    if (amountMinor < session.nextMinimumMinor) {
      // Se avisa antes de ir al servidor, pero el servidor vuelve a validarlo:
      // esto es cortesía, no la regla.
      setError(`El mínimo ahora es ${money(session.nextMinimumMinor, session.currency)}.`);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await placeBid(session.id, amountMinor);
      if (result.status === 'error') {
        setError(result.message ?? 'No pudimos registrar tu oferta.');
        return;
      }
      setOpen(false);
      setTyped(null);
      onRefresh();
    });
  };

  if (session.status === 'sold' || session.status === 'closed') {
    return (
      <section className="rounded-3xl bg-black/60 p-4 text-white backdrop-blur-sm">
        <p className="text-[15px] font-extrabold">
          {session.status === 'sold' ? '✅ Vendido' : 'Puja finalizada'}
        </p>
        <p className="text-[13px] text-white/75">
          {session.status === 'sold'
            ? `${leader?.bidderName ?? 'Alguien'} · ${money(leader?.amountMinor ?? 0, session.currency)}`
            : 'El vendedor cerró esta puja sin aceptar ofertas.'}
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-3xl bg-black/60 p-4 text-white backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-extrabold uppercase tracking-wide">
            <FlameIcon /> Modo puja
          </span>
          {session.status === 'reserved' ? (
            <Badge tone="warning">Reservado</Badge>
          ) : (
            <span className="text-[12px] text-white/70">
              {session.bids.length === 0
                ? 'Sin ofertas todavía'
                : `${session.bids.length} ${session.bids.length === 1 ? 'oferta' : 'ofertas'}`}
            </span>
          )}
        </div>

        <p className="truncate text-[15px] font-bold">{session.product.title}</p>

        <div className="flex items-end gap-6">
          <span>
            <span className="block text-[11px] uppercase tracking-wide text-white/60">
              Referencia
            </span>
            <span className="block text-[15px] font-semibold text-white/85">
              {money(session.referencePriceMinor, session.currency)}
            </span>
          </span>
          <span>
            <span className="block text-[11px] uppercase tracking-wide text-white/60">
              Mejor oferta
            </span>
            <span className="block text-[22px] font-extrabold leading-tight">
              {leader ? money(leader.amountMinor, session.currency) : '—'}
            </span>
          </span>
        </div>

        {session.bids.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {session.bids.slice(0, 3).map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-white/80">{bid.bidderName}</span>
                <span className={bid.outcome === 'leading' ? 'font-bold' : 'text-white/60'}>
                  {money(bid.amountMinor, session.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {won ? (
          // El `key` es la oferta ganadora: una reserva nueva sobre la misma
          // puja remonta el contador en vez de seguir descontando el viejo.
          <WinnerCallout key={session.viewerBid?.id ?? session.id} session={session} />
        ) : session.status === 'reserved' ? (
          <p className="rounded-2xl bg-white/10 px-3 py-2 text-[13px] text-white/85">
            El vendedor aceptó una oferta. Si no se concreta, la puja puede reabrirse.
          </p>
        ) : (
          <Button block loading={pending} onClick={() => setOpen(true)}>
            {isSignedIn ? 'Hacer una oferta' : 'Ingresá para ofertar'}
          </Button>
        )}

        {isMine && session.status === 'open' ? (
          <p className="text-center text-[12px] font-semibold text-white/80">
            Vas ganando con {money(session.viewerBid?.amountMinor ?? 0, session.currency)}
          </p>
        ) : null}
      </section>

      <Sheet open={open} onClose={() => setOpen(false)} title="Tu oferta">
        <div className="flex flex-col gap-4 pb-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-subtle">Cuánto ofrecés</span>
            <span className="flex items-center gap-2 rounded-2xl border border-line bg-bg px-4">
              <span className="text-[20px] font-bold text-subtle">$</span>
              <input
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(event) => setTyped(event.target.value)}
                className="h-14 flex-1 bg-transparent text-[22px] font-extrabold text-ink outline-none"
                aria-label="Monto de tu oferta"
              />
            </span>
          </label>

          <dl className="flex flex-col gap-1 text-[14px]">
            <Row
              label="Oferta actual"
              value={leader ? money(leader.amountMinor, session.currency) : 'Sin ofertas'}
            />
            <Row
              label="Mínimo siguiente"
              value={money(session.nextMinimumMinor, session.currency)}
              strong
            />
          </dl>

          {error ? (
            <p
              role="alert"
              className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger"
            >
              {error}
            </p>
          ) : null}

          <Button block loading={pending} onClick={submit}>
            Enviar oferta
          </Button>
          <p className="text-center text-[12px] text-subtle">
            El vendedor decide qué oferta acepta. Puede aceptar por debajo de la referencia.
          </p>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Lo que ve quien ganó: cuánto, cuánto le queda, y el botón para pagar.
 *
 * La cuenta regresiva arranca del valor que dio el **servidor** y solo
 * descuenta. No se guarda una fecha límite calculada en el navegador porque el
 * reloj de un teléfono puede estar corrido, y quien decide si la reserva
 * venció es el servidor de todas formas — esto es información, no la regla.
 *
 * No se resincroniza con la prop y no hace falta: durante una reserva nadie
 * puede ofertar, así que no llegan eventos que refresquen la sesión. Si
 * apareciera una reserva nueva —reabrir y volver a aceptar— cambia la oferta
 * ganadora, y el `key` del padre remonta el componente con el valor nuevo.
 */
function WinnerCallout({ session }: { session: BidSessionDto }) {
  const [secondsLeft, setSecondsLeft] = useState(session.reservationSecondsLeft);

  useEffect(() => {
    const timer = setInterval(
      () => setSecondsLeft((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-success/15 p-3">
      <p className="text-[15px] font-extrabold">🎉 ¡Tu oferta fue aceptada!</p>
      <p className="text-[20px] font-extrabold leading-tight">
        {money(session.viewerBid?.amountMinor ?? 0, session.currency)}
      </p>
      <p className="text-[13px] text-white/85">
        {secondsLeft > 0
          ? `Tenés ${minutes}:${seconds} para completar el pago.`
          : 'Se venció el tiempo para pagar.'}
      </p>
      {secondsLeft > 0 ? (
        <a
          href={
            `/checkout?producto=${session.product.id}` +
            `&variante=${session.variantId}` +
            `&oferta=${session.viewerBid?.id ?? ''}`
          }
          className="inline-flex h-13 w-full items-center justify-center rounded-2xl bg-brand text-base font-extrabold text-white"
        >
          Pagar ahora
        </a>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className={strong ? 'font-extrabold text-ink' : 'font-semibold text-ink'}>{value}</dd>
    </div>
  );
}

function FlameIcon() {
  return (
    <span aria-hidden className="text-[14px]">
      🔥
    </span>
  );
}
