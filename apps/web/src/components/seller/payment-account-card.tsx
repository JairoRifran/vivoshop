'use client';

import type { PaymentCapabilitiesDto, SellerPaymentAccountDto } from '@vivo/shared';
import { Badge, Button } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { connectPaymentAccount, disconnectPaymentAccount } from '@/lib/actions/payments';

const PROVIDER_LABEL: Record<string, string> = {
  mercadopago: 'Mercado Pago',
  fake: 'Proveedor de prueba',
};

/**
 * La cuenta con la que cobra la tienda.
 *
 * Lo que se muestra es el mínimo honesto: si está conectada, a nombre de qué y
 * desde cuándo. Ni un token, ni el id interno del proveedor — la API tampoco
 * los manda, así que esto no puede filtrarlos ni por accidente.
 */
export function PaymentAccountCard({
  account,
  capabilities,
}: {
  account: SellerPaymentAccountDto | null;
  capabilities: PaymentCapabilitiesDto;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const providerName = PROVIDER_LABEL[capabilities.provider] ?? capabilities.provider;
  const connected = account?.status === 'connected';

  const connect = () => {
    setError(null);
    startTransition(async () => {
      const result = await connectPaymentAccount();
      if (result.status === 'error' || !result.url) {
        setError(result.message ?? 'No pudimos abrir la conexión.');
        return;
      }
      window.location.assign(result.url);
    });
  };

  const disconnect = () => {
    setError(null);
    startTransition(async () => {
      const result = await disconnectPaymentAccount();
      if (result.status === 'error') setError(result.message ?? 'No pudimos desconectar la cuenta.');
      else {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold tracking-tight">Cobros</h2>
          <p className="text-[13px] leading-relaxed text-subtle">
            {connected
              ? `El dinero de tus ventas entra directo a tu cuenta de ${providerName}.`
              : `Conectá tu cuenta de ${providerName} para recibir el dinero de tus ventas.`}
          </p>
        </div>
        <Badge tone={connected ? 'success' : 'neutral'}>
          {connected ? 'Conectada' : 'Sin conectar'}
        </Badge>
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {account?.status === 'expired' ? (
        <p role="alert" className="rounded-2xl bg-warning/10 px-4 py-3 text-[13px] text-ink-soft">
          El permiso venció y hay que renovarlo. Mientras tanto no vas a poder cobrar por la app.
        </p>
      ) : null}

      {connected ? (
        <>
          <dl className="flex flex-col divide-y divide-line text-[14px]">
            <Row label="Cuenta" value={account?.accountLabel ?? providerName} />
            <Row
              label="Conectada el"
              value={
                account?.connectedAt
                  ? new Date(account.connectedAt).toLocaleDateString('es-UY')
                  : '—'
              }
            />
          </dl>
          {confirming ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-danger/25 bg-danger/5 p-4">
              <p className="text-[14px] font-semibold">¿Desconectar la cuenta?</p>
              <p className="text-[13px] text-subtle">
                Dejás de poder cobrar por la app hasta que la vuelvas a conectar. Tus ventas y tu
                tienda no se tocan.
              </p>
              <div className="flex gap-2 pt-1">
                <Button variant="danger" size="md" loading={pending} onClick={disconnect}>
                  Sí, desconectar
                </Button>
                <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
                  Volver
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="py-1 text-left text-sm font-semibold text-subtle underline underline-offset-4 transition-colors hover:text-danger"
            >
              Desconectar cuenta
            </button>
          )}
        </>
      ) : (
        <Button block loading={pending} onClick={connect}>
          Conectar {providerName}
        </Button>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}
