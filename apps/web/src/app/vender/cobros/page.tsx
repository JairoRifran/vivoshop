import type { Metadata } from 'next';
import { PaymentAccountCard } from '@/components/seller/payment-account-card';
import { api, safe } from '@/lib/api';
import { money } from '@/lib/format';

export const metadata: Metadata = { title: 'Cobros' };
export const dynamic = 'force-dynamic';

const CONNECTION_MESSAGE: Record<string, { tone: 'success' | 'danger'; text: string }> = {
  lista: { tone: 'success', text: 'Listo. Ya podés cobrar tus ventas por la app.' },
  cancelada: { tone: 'danger', text: 'No autorizaste la conexión. Podés intentarlo cuando quieras.' },
  error: { tone: 'danger', text: 'No pudimos completar la conexión. Probá de nuevo.' },
};

/**
 * Cobros del vendedor.
 *
 * La pantalla contesta tres preguntas, en ese orden: si puede cobrar, cuánto
 * le queda de cada venta y qué se cobró hasta ahora. La comisión se muestra
 * sobre cada pago con la tasa que se aplicó —no la vigente hoy—, porque lo
 * cobrado ayer tiene que seguir explicándose aunque la política cambie.
 */
export default async function SellerPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ conexion?: string }>;
}) {
  const { conexion } = await searchParams;

  const client = await api();
  const [account, capabilities, payments] = await Promise.all([
    safe(client.payments.account(), null),
    client.payments.capabilities(),
    safe(client.payments.list(), []),
  ]);

  const notice = conexion ? CONNECTION_MESSAGE[conexion] : undefined;
  const approved = payments.filter((payment) => payment.status === 'approved');
  const currency = approved[0]?.currency ?? 'UYU';
  const totals = approved.reduce(
    (sum, payment) => ({
      gross: sum.gross + payment.grossMinor,
      commission: sum.commission + payment.commissionMinor,
      net: sum.net + payment.netMinor,
    }),
    { gross: 0, commission: 0, net: 0 },
  );

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="px-4 pt-3">
        <h1 className="text-[24px] font-extrabold tracking-tight">Cobros</h1>
        <p className="text-[13px] text-subtle">Cómo recibís el dinero de tus ventas</p>
      </header>

      {notice ? (
        <p
          role="status"
          className={`mx-4 rounded-2xl px-4 py-3 text-sm font-semibold ${
            notice.tone === 'success'
              ? 'bg-success/10 text-success-ink'
              : 'bg-danger/8 text-danger'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="px-4">
        <PaymentAccountCard account={account} capabilities={capabilities} />
      </div>

      <section className="mx-4 grid grid-cols-3 gap-2">
        <Stat label="Cobrado" value={money(totals.gross, currency)} />
        <Stat label="Comisión" value={money(totals.commission, currency)} />
        <Stat label="Te queda" value={money(totals.net, currency)} strong />
      </section>

      <section className="flex flex-col gap-2 px-4 pb-4">
        <h2 className="text-[17px] font-extrabold tracking-tight">Movimientos</h2>

        {payments.length === 0 ? (
          <p className="rounded-3xl bg-surface px-4 py-6 text-center text-[14px] text-subtle shadow-card">
            Todavía no hay cobros. Cuando alguien te compre, el detalle aparece acá.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">
                    {money(payment.grossMinor, payment.currency)}
                  </p>
                  <p className="truncate text-[12px] text-subtle">
                    {/* La tasa aplicada, no la vigente. */}
                    Comisión {(payment.commissionRateBps / 100).toFixed(1)}% ·{' '}
                    {money(payment.commissionMinor, payment.currency)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[14px] font-extrabold">
                    {money(payment.netMinor, payment.currency)}
                  </p>
                  <p className="text-[12px] text-subtle">{STATUS_LABEL[payment.status]}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Acreditado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  expired: 'Vencido',
  refunded: 'Devuelto',
};

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface px-3 py-2.5 text-center shadow-card">
      <p className={`text-[15px] leading-tight ${strong ? 'font-extrabold' : 'font-bold'}`}>
        {value}
      </p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
    </div>
  );
}
