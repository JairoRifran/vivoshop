'use client';

import type { OrderStatus, ProtectionStatus } from '@vivo/domain';
import { Button } from '@vivo/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  cancelOrder,
  confirmReceipt,
  openDispute,
  startPayment,
} from '@/lib/actions/checkout';

const DISPUTE_REASONS = [
  { value: 'not_received', label: 'No me llegó' },
  { value: 'wrong_item', label: 'Me llegó otra cosa' },
  { value: 'damaged', label: 'Llegó dañado' },
  { value: 'not_as_described', label: 'No es como se describía' },
] as const;

/**
 * Acciones del comprador sobre su pedido.
 *
 * Qué botones existen se deriva del estado en vez de renderizarlos todos y
 * deshabilitarlos: un "Cancelar" gris sobre un pedido entregado es ruido, no
 * información.
 */
export function OrderActions({
  orderId,
  status,
  protection,
  storeSlug,
  liveSessionId,
  canDispute,
}: {
  orderId: string;
  status: OrderStatus;
  protection: ProtectionStatus;
  storeSlug: string;
  liveSessionId: string | null;
  /** El proveedor tiene circuito de reclamos. Si no, este botón no existe. */
  canDispute: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [reason, setReason] = useState<(typeof DISPUTE_REASONS)[number]['value']>('not_received');
  const [detail, setDetail] = useState('');

  const run = (task: () => Promise<{ status: string; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.status === 'error') setError(result.message ?? 'No pudimos completar la acción.');
      else router.refresh();
    });
  };

  /**
   * Pagar sale de la app.
   *
   * La navegación se hace acá y no con un `redirect` del servidor para poder
   * mostrar un error si el cobro no se pudo abrir: redirigir desde el servidor
   * dejaría al comprador mirando una pantalla en blanco cuando el proveedor
   * está caído.
   */
  const pay = () => {
    setError(null);
    startTransition(async () => {
      const result = await startPayment(orderId);
      if (result.status === 'error' || !result.url) {
        setError(result.message ?? 'No pudimos abrir el pago.');
        return;
      }
      window.location.assign(result.url);
    });
  };

  const canPay = status === 'pending_payment';
  const canCancel = status === 'pending_payment' || status === 'paid';
  const canConfirmReceipt = status === 'delivered' && protection !== 'disputed';
  const disputable =
    canDispute &&
    protection === 'protected' &&
    (status === 'paid' || status === 'shipped' || status === 'delivered');

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {canPay ? (
        <Button block loading={pending} onClick={pay}>
          Pagar ahora
        </Button>
      ) : null}

      {canConfirmReceipt ? (
        <Button block loading={pending} onClick={() => run(() => confirmReceipt(orderId))}>
          Recibí mi compra
        </Button>
      ) : null}

      {liveSessionId ? (
        <Button variant="outline" block onClick={() => router.push(`/live/${liveSessionId}`)}>
          Volver al vivo
        </Button>
      ) : null}

      <Link
        href={`/tienda/${storeSlug}`}
        className="inline-flex h-14 w-full items-center justify-center rounded-2xl border border-line bg-surface text-base font-semibold text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Ver la tienda
      </Link>

      {disputable ? (
        claiming ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <p className="text-[14px] font-extrabold text-ink">¿Qué pasó con tu compra?</p>
            <div className="flex flex-col gap-2">
              {DISPUTE_REASONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-[14px]">
                  <input
                    type="radio"
                    name="dispute-reason"
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="size-4"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-[13px] text-subtle">
              Contanos un poco más (opcional)
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                maxLength={600}
                rows={3}
                className="rounded-xl border border-line bg-bg p-3 text-[14px] text-ink"
              />
            </label>
            <div className="flex gap-2">
              <Button
                size="md"
                loading={pending}
                onClick={() => run(() => openDispute(orderId, reason, detail))}
              >
                Enviar reclamo
              </Button>
              <Button variant="ghost" size="md" onClick={() => setClaiming(false)}>
                Volver
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setClaiming(true)}
            className="py-2 text-center text-sm font-semibold text-subtle underline underline-offset-4 transition-colors hover:text-ink"
          >
            Tengo un problema con esta compra
          </button>
        )
      ) : null}

      {canCancel ? (
        confirmingCancel ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-danger/25 bg-danger/5 p-4">
            <p className="text-[14px] font-semibold text-ink">
              ¿Seguro que querés cancelar este pedido?
            </p>
            <p className="text-[13px] text-subtle">
              Las unidades vuelven al stock de la tienda y no se puede deshacer.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                variant="danger"
                size="md"
                loading={pending}
                onClick={() => run(() => cancelOrder(orderId))}
              >
                Sí, cancelar
              </Button>
              <Button variant="ghost" size="md" onClick={() => setConfirmingCancel(false)}>
                Volver
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            className="py-2 text-center text-sm font-semibold text-subtle underline underline-offset-4 transition-colors hover:text-danger"
          >
            Cancelar pedido
          </button>
        )
      ) : null}
    </div>
  );
}
