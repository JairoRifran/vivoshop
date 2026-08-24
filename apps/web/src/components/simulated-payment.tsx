'use client';

import { Button } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { simulatePayment } from '@/lib/actions/checkout';

/**
 * La pantalla del proveedor de pagos, cuando el proveedor es el simulado.
 *
 * Existe para que el recorrido de desarrollo sea el mismo que el de
 * producción: el comprador sale de la app, decide, y vuelve. Lo que hace el
 * botón no es marcar el pedido como pagado —eso sería saltarse todo lo que
 * este milestone construye— sino pedirle al proveedor simulado que emita su
 * aviso, que después recorre el webhook completo.
 *
 * Con Mercado Pago esta pantalla no aparece: la API rechaza la simulación.
 */
export function SimulatedPayment({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (outcome: 'approved' | 'rejected') => {
    setError(null);
    startTransition(async () => {
      const result = await simulatePayment(orderId, outcome);
      if (result.status === 'error') {
        setError(result.message ?? 'No pudimos procesar el pago.');
        return;
      }
      router.replace(`/compras/${orderId}?${outcome === 'approved' ? 'nuevo=1' : 'pago=rechazado'}`);
      router.refresh();
    });
  };

  return (
    <section className="mx-4 flex flex-col gap-3 rounded-3xl border border-dashed border-line bg-surface p-4">
      <div>
        <p className="text-[15px] font-extrabold">Pago de prueba</p>
        <p className="text-[13px] leading-relaxed text-subtle">
          Este entorno no cobra dinero real. Elegí cómo querés que responda el proveedor para
          probar el recorrido completo.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button loading={pending} onClick={() => decide('approved')}>
          Pagar
        </Button>
        <Button variant="outline" loading={pending} onClick={() => decide('rejected')}>
          Rechazar el pago
        </Button>
      </div>
    </section>
  );
}
