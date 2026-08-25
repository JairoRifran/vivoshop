'use client';

import type { BidSessionDto, ProductSummaryDto } from '@vivo/shared';
import { Badge, Button, Sheet } from '@vivo/ui';
import { useState, useTransition } from 'react';
import {
  acceptBid,
  closeBidSession,
  openBidSession,
  reopenBidSession,
} from '@/lib/actions/bids';
import { money } from '@/lib/format';

/**
 * Modo Puja, del lado de quien decide.
 *
 * El vendedor está transmitiendo desde un teléfono, sostiene el producto con
 * una mano y opera con la otra. Eso ordena la pantalla más que cualquier
 * criterio estético:
 *
 *  - La mejor oferta ocupa el lugar grande, con el nombre. Es lo único que hay
 *    que leer sin acercarse.
 *  - Aceptar es un botón grande, y **pide confirmación**. Un tap accidental
 *    sobre "aceptar" vende un producto a un precio que el vendedor no eligió,
 *    y no hay forma de deshacerlo — la unidad ya salió del stock y alguien ya
 *    está pagando. La confirmación es corta, no un formulario: dice el monto y
 *    el nombre, que es lo que hay que verificar.
 *  - Cerrar la puja está abajo y sin destacar. Es legítimo, no es lo habitual.
 */
export function BidConsole({
  liveSessionId,
  products,
  sessions,
  onChanged,
}: {
  liveSessionId: string;
  products: readonly ProductSummaryDto[];
  sessions: readonly BidSessionDto[];
  onChanged: () => void;
}) {
  const active = sessions.find(
    (session) => session.status === 'open' || session.status === 'reserved',
  );
  const expired = sessions.find((session) => session.status === 'expired');

  if (active) {
    return <ActiveBid session={active} onChanged={onChanged} />;
  }
  if (expired) {
    return <ExpiredBid session={expired} onChanged={onChanged} />;
  }
  return <OpenBidForm liveSessionId={liveSessionId} products={products} onChanged={onChanged} />;
}

function ActiveBid({ session, onChanged }: { session: BidSessionDto; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<BidSessionDto['bids'][number] | null>(null);
  const [closing, setClosing] = useState(false);

  const run = (task: () => Promise<{ status: string; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.status === 'error') {
        setError(result.message ?? 'No pudimos completar la acción.');
        return;
      }
      setConfirming(null);
      setClosing(false);
      onChanged();
    });
  };

  const leader = session.leadingBid;
  const others = session.bids.filter((bid) => bid.id !== leader?.id).slice(0, 4);
  const reserved = session.status === 'reserved';

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-white/10 p-4 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold uppercase tracking-wide">🔥 Puja activa</span>
        {reserved ? <Badge tone="warning">Reservado</Badge> : null}
      </div>

      <p className="truncate text-[15px] font-bold">{session.product.title}</p>

      {error ? (
        <p role="alert" className="rounded-2xl bg-danger/20 px-4 py-3 text-sm font-semibold">
          {error}
        </p>
      ) : null}

      {leader ? (
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-white/60">
            Mejor oferta
          </span>
          <span className="block truncate text-[15px] font-semibold text-white/90">
            {leader.bidderName}
          </span>
          <span className="block text-[32px] font-extrabold leading-tight">
            {money(leader.amountMinor, session.currency)}
          </span>
        </div>
      ) : (
        <p className="text-[14px] text-white/70">
          Todavía nadie ofertó. La referencia es{' '}
          {money(session.referencePriceMinor, session.currency)}.
        </p>
      )}

      {!reserved && leader ? (
        <Button block size="lg" onClick={() => setConfirming(leader)}>
          Aceptar {money(leader.amountMinor, session.currency)}
        </Button>
      ) : null}

      {reserved ? (
        <p className="rounded-2xl bg-white/10 px-3 py-2 text-[13px] text-white/85">
          Esperando el pago de {leader?.bidderName ?? 'quien ganó'}. Si no paga, vas a poder
          reabrir la puja.
        </p>
      ) : null}

      {others.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-white/60">Otras ofertas</span>
          {others.map((bid) => (
            <div key={bid.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-[14px] text-white/85">{bid.bidderName}</span>
              <span className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">
                  {money(bid.amountMinor, session.currency)}
                </span>
                {!reserved ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(bid)}
                    className="rounded-xl border border-white/25 px-3 py-1.5 text-[13px] font-bold"
                  >
                    Aceptar
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!reserved ? (
        closing ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/20 p-3">
            <p className="text-[14px] font-semibold">¿Cerrar la puja sin vender?</p>
            <p className="text-[13px] text-white/70">
              Las ofertas quedan sin efecto y el producto vuelve a venderse a precio normal.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="danger"
                size="md"
                loading={pending}
                onClick={() => run(() => closeBidSession(session.id))}
              >
                Sí, cerrar
              </Button>
              <Button variant="ghost" size="md" onClick={() => setClosing(false)}>
                Volver
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setClosing(true)}
            className="py-2 text-center text-sm font-semibold text-white/70 underline underline-offset-4"
          >
            Cerrar puja
          </button>
        )
      ) : null}

      {/*
        La confirmación de aceptar: corta, con el monto y el nombre grandes.
        Es lo único que separa un tap accidental de una venta a un precio que
        el vendedor no eligió, y esa venta no se puede deshacer.
      */}
      <Sheet open={Boolean(confirming)} onClose={() => setConfirming(null)} title="Confirmá la venta">
        {confirming ? (
          <div className="flex flex-col gap-4 pb-2">
            <div className="rounded-3xl bg-muted p-4 text-center">
              <p className="text-[14px] text-subtle">Le vendés a</p>
              <p className="text-[18px] font-extrabold text-ink">{confirming.bidderName}</p>
              <p className="pt-1 text-[34px] font-extrabold leading-none text-ink">
                {money(confirming.amountMinor, session.currency)}
              </p>
            </div>
            <p className="text-center text-[13px] text-subtle">
              El producto queda reservado y no se puede deshacer.
            </p>
            <Button
              block
              size="lg"
              loading={pending}
              onClick={() => run(() => acceptBid(session.id, confirming.id))}
            >
              Sí, aceptar la oferta
            </Button>
            <Button variant="ghost" block onClick={() => setConfirming(null)}>
              Volver
            </Button>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

/**
 * La reserva venció y el ganador no pagó.
 *
 * "Ofrecerle al segundo" es reabrir y aceptar la siguiente: las demás ofertas
 * siguen vivas. No hay un botón separado porque sería el mismo camino con otro
 * nombre — y cobrarle al segundo sin que el vendedor decida es justamente lo
 * que no queremos.
 */
function ExpiredBid({ session, onChanged }: { session: BidSessionDto; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();

  const run = (task: () => Promise<{ status: string }>) =>
    startTransition(async () => {
      await task();
      onChanged();
    });

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-4 text-white">
      <span className="text-[13px] font-extrabold uppercase tracking-wide">Puja sin pago</span>
      <p className="truncate text-[15px] font-bold">{session.product.title}</p>
      <p className="text-[13px] text-white/75">
        Quien ganó no pagó a tiempo. El producto volvió al stock. Si reabrís, las otras ofertas
        siguen en pie y podés aceptar la que sigue.
      </p>
      <div className="flex gap-2">
        <Button loading={pending} onClick={() => run(() => reopenBidSession(session.id))}>
          Reabrir puja
        </Button>
        <Button variant="outline" loading={pending} onClick={() => run(() => closeBidSession(session.id))}>
          Cerrar
        </Button>
      </div>
    </section>
  );
}

/** Abrir una puja: producto, y dos mínimos opcionales. */
function OpenBidForm({
  liveSessionId,
  products,
  onChanged,
}: {
  liveSessionId: string;
  products: readonly ProductSummaryDto[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [minimumBid, setMinimumBid] = useState('');
  const [increment, setIncrement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toMinor = (value: string): number | null => {
    const parsed = Number(value.replace(',', '.'));
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
  };

  const submit = () => {
    if (!productId) {
      setError('Elegí qué producto vas a pujar.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await openBidSession({
        liveSessionId,
        productId,
        minimumBidMinor: toMinor(minimumBid),
        minimumIncrementMinor: toMinor(increment),
      });
      if (result.status === 'error') {
        setError(result.message ?? 'No pudimos abrir la puja.');
        return;
      }
      setOpen(false);
      onChanged();
    });
  };

  if (products.length === 0) return null;

  return (
    <>
      <Button variant="outline" block onClick={() => setOpen(true)}>
        🔥 Activar Modo Puja
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Abrir una puja">
        <div className="flex flex-col gap-4 pb-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-subtle">Producto</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="h-14 rounded-2xl border border-line bg-bg px-4 text-[15px] font-semibold text-ink"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} · {money(product.priceMinor, product.currency)}
                </option>
              ))}
            </select>
          </label>

          <p className="rounded-2xl bg-muted px-4 py-3 text-[13px] text-ink-soft">
            El precio de la ficha se muestra como referencia. Podés aceptar una oferta más baja si
            te sirve — la decisión es tuya.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-subtle">Oferta mínima (opcional)</span>
            <input
              inputMode="decimal"
              value={minimumBid}
              onChange={(event) => setMinimumBid(event.target.value)}
              placeholder="Sin mínimo"
              className="h-14 rounded-2xl border border-line bg-bg px-4 text-[15px] font-semibold text-ink"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-subtle">
              Incremento mínimo (opcional)
            </span>
            <input
              inputMode="decimal"
              value={increment}
              onChange={(event) => setIncrement(event.target.value)}
              placeholder="Sin incremento"
              className="h-14 rounded-2xl border border-line bg-bg px-4 text-[15px] font-semibold text-ink"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <Button block size="lg" loading={pending} onClick={submit}>
            Abrir la puja
          </Button>
        </div>
      </Sheet>
    </>
  );
}
