import { isApiError } from '@vivo/shared';
import { Badge } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeftIcon, StoreIcon, TruckIcon } from '@/components/icons';
import { OrderActions } from '@/components/order-actions';
import { OrderTimeline } from '@/components/order-timeline';
import { ProtectionNotice } from '@/components/protection-notice';
import { SimulatedPayment } from '@/components/simulated-payment';
import { VerifiedBadge } from '@/components/verified-badge';
import { api, getCurrentUser } from '@/lib/api';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, dateTime, money } from '@/lib/format';

export const metadata: Metadata = { title: 'Detalle del pedido' };
export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string; pago?: string; simular?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const user = await getCurrentUser();
  if (!user) redirect(`/ingresar?next=${encodeURIComponent(`/compras/${id}`)}`);

  const client = await api();
  let order;
  let capabilities;
  try {
    // Las dos consultas son independientes; en secuencia serian dos viajes.
    [order, capabilities] = await Promise.all([
      client.orders.byId(id),
      client.payments.capabilities(),
    ]);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    throw error;
  }

  const justPlaced = query.nuevo === '1';
  // El proveedor simulado vuelve a esta pantalla con `?simular=`. Con un
  // proveedor real el parametro no existe y el panel no se dibuja.
  const simulating = Boolean(query.simular) && order.status === 'pending_payment';
  // La vuelta del proveedor **no** decide nada: dice que el comprador volvio,
  // no que se cobro. El parametro solo elige si vale la pena explicar lo que
  // paso; lo que se afirma sale del estado guardado, no de la URL.
  const paymentFailed =
    query.pago === 'rechazado' &&
    order.status === 'cancelled' &&
    order.payment.status !== 'approved';

  return (
    <div className="flex flex-col gap-6 pb-6 pt-safe">
      <header className="flex items-center gap-2 px-3 pt-2">
        <Link
          href="/compras"
          aria-label="Volver a mis compras"
          className="grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-extrabold tracking-tight">
            Pedido {order.code}
          </h1>
          <p className="text-[13px] text-subtle">{dateTime(order.createdAt)}</p>
        </div>
      </header>

      {simulating ? <SimulatedPayment orderId={order.id} /> : null}

      {paymentFailed ? (
        <div role="status" className="mx-4 rounded-3xl bg-danger/8 px-4 py-4">
          <p className="text-[15px] font-extrabold text-danger">No se pudo completar el pago</p>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {/* Honesto sobre lo que pasó de verdad: el pedido se cancela y las
                unidades vuelven a la tienda. Decir "seguí intentando" sería
                prometer una reserva que ya no existe. */}
            Cancelamos el pedido y las unidades volvieron a {order.store.name}. Podés comprarlo de
            nuevo cuando quieras.
          </p>
        </div>
      ) : null}

      {justPlaced ? (
        <div
          role="status"
          className="mx-4 flex items-start gap-3 rounded-3xl bg-success/8 px-4 py-4"
        >
          <span aria-hidden className="text-2xl">
            🎉
          </span>
          <div>
            <p className="text-[15px] font-extrabold text-success-ink">¡Compra confirmada!</p>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {order.store.name} ya recibió tu pedido. Te avisamos cuando lo prepare.
            </p>
          </div>
        </div>
      ) : null}

      <section className="mx-4 flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          <span className="flex min-w-0 items-center gap-1">
            <Link
              href={`/tienda/${order.store.slug}`}
              className="truncate text-[13px] font-bold text-ink underline underline-offset-4"
            >
              {order.store.name}
            </Link>
            {order.store.isVerified ? <VerifiedBadge size="sm" /> : null}
          </span>
        </div>
        <OrderTimeline order={order} />
      </section>

      {order.protection === 'not_applicable' ? null : (
        <ProtectionNotice
          capabilities={capabilities}
          status={order.protection}
          className="mx-4"
        />
      )}

      <section className="mx-4 flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-card">
        <h2 className="text-[15px] font-extrabold">
          {order.items.length === 1 ? 'Producto' : 'Productos'}
        </h2>
        <ul className="flex flex-col gap-3">
          {order.items.map((item) => (
            <li key={`${item.productId}-${item.variantId}`} className="flex items-center gap-3">
              <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="size-full object-cover" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/producto/${item.productId}`}
                  className="block truncate text-[15px] font-semibold hover:underline"
                >
                  {item.title}
                </Link>
                <span className="block text-[13px] text-subtle">
                  {item.variantLabel ? `${item.variantLabel} · ` : ''}
                  {item.quantity} × {money(item.unitPriceMinor, order.currency)}
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-bold">
                {money(item.subtotalMinor, order.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-[14px]">
          <Row label="Subtotal" value={money(order.subtotalMinor, order.currency)} />
          <Row
            label="Envío"
            value={
              order.shippingMinor === 0 ? 'Sin costo' : money(order.shippingMinor, order.currency)
            }
          />
          <Row label="IVA incluido" value={money(order.taxMinor, order.currency)} muted />
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="text-[15px] font-extrabold">Total</dt>
            <dd className="text-[19px] font-extrabold">
              {money(order.totalMinor, order.currency)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mx-4 flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-card">
        <h2 className="text-[15px] font-extrabold">Entrega</h2>
        <div className="flex items-start gap-3">
          {order.delivery.kind === 'shipping' ? (
            <TruckIcon className="mt-0.5 size-5 shrink-0 text-subtle" />
          ) : (
            <StoreIcon className="mt-0.5 size-5 shrink-0 text-subtle" />
          )}
          <div className="min-w-0 text-[14px] leading-relaxed">
            <p className="font-bold">{order.delivery.label}</p>
            <p className="text-subtle">{order.delivery.estimate}</p>
            {order.delivery.address ? (
              <address className="not-italic text-ink-soft">
                {order.delivery.address.recipientName}
                <br />
                {order.delivery.address.street}
                <br />
                {order.delivery.address.locality}, {order.delivery.address.regionName}
                {order.delivery.address.notes ? (
                  <>
                    <br />
                    <span className="text-subtle">{order.delivery.address.notes}</span>
                  </>
                ) : null}
              </address>
            ) : null}
            {order.delivery.trackingCode ? (
              <p className="pt-1">
                Seguimiento:{' '}
                <span className="font-mono font-bold">{order.delivery.trackingCode}</span>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-4 flex items-center justify-between gap-3 rounded-3xl bg-surface p-4 shadow-card">
        <div>
          <h2 className="text-[15px] font-extrabold">Pago</h2>
          <p className="text-[14px] text-subtle">
            {order.payment.label}
            {order.payment.installments > 1 ? ` · ${order.payment.installments} cuotas` : ''}
          </p>
        </div>
        <Badge tone={order.payment.status === 'approved' ? 'success' : 'warning'}>
          {order.payment.status === 'approved' ? 'Pagado' : 'Pendiente'}
        </Badge>
      </section>

      <div className="mx-4">
        <OrderActions
          orderId={order.id}
          status={order.status}
          protection={order.protection}
          storeSlug={order.store.slug}
          liveSessionId={order.liveSessionId}
          canDispute={capabilities.supportsDisputes}
        />
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? 'text-subtle' : 'text-ink-soft'}>{label}</dt>
      <dd className={muted ? 'text-subtle' : 'font-semibold'}>{value}</dd>
    </div>
  );
}
