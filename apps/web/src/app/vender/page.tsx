import { Avatar, Badge, Button, buttonClasses, LiveDot } from '@vivo/ui';
import Link from 'next/link';
import { CalendarIcon, ChevronRightIcon } from '@/components/icons';
import { BecomeSellerForm } from '@/components/seller/become-seller-form';
import { api, getCurrentUser, safe } from '@/lib/api';
import { money, scheduleLabel, viewers } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SellerHomePage() {
  const client = await api();
  const [user, store] = await Promise.all([getCurrentUser(), safe(client.stores.mine(), null)]);

  if (!store) return <BecomeSellerForm defaultName={user?.name ?? ''} />;

  const [metrics, orders] = await Promise.all([
    client.seller.metrics(),
    safe(client.orders.sellerList({ status: 'paid' }), []),
  ]);

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="flex items-center gap-3 px-4 pt-3">
        <Avatar src={store.logoUrl} name={store.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-subtle">
            Modo vendedor
          </p>
          <h1 className="truncate text-[20px] font-extrabold tracking-tight">{store.name}</h1>
        </div>
        <Link
          href={`/tienda/${store.slug}`}
          className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-bold text-ink transition-colors hover:bg-muted"
        >
          Ver tienda
        </Link>
      </header>

      {/* --- Broadcast controls: the reason this screen exists ------------- */}
      <section className="px-4">
        {metrics.activeLive ? (
          <Link
            href={`/transmitir/${metrics.activeLive.id}`}
            className="flex items-center gap-3 rounded-3xl bg-live px-5 py-4 text-white shadow-lg shadow-live/25 transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <LiveDot className="size-3" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-white/80">
                Estás en vivo
              </p>
              <p className="truncate text-[16px] font-extrabold">{metrics.activeLive.title}</p>
              <p className="text-[13px] text-white/85">
                {viewers(metrics.activeLive.viewerCount)} mirando
              </p>
            </div>
            <ChevronRightIcon className="size-6 shrink-0" />
          </Link>
        ) : (
          <div className="flex flex-col gap-2">
            <Link href="/vender/lives/nuevo?modo=ahora" className="block">
              <Button variant="live" block size="lg" className="text-[17px]">
                Iniciar live
              </Button>
            </Link>
            <Link href="/vender/lives/nuevo?modo=programar" className="block">
              <Button variant="outline" block size="lg">
                <CalendarIcon className="size-5" />
                Programar live
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* --- Metrics ---------------------------------------------------------- */}
      <section className="grid grid-cols-2 gap-3 px-4">
        <Metric
          label="Ventas hoy"
          value={money(metrics.salesTodayMinor, metrics.currency)}
          note={`${metrics.ordersToday} ${metrics.ordersToday === 1 ? 'pedido' : 'pedidos'}`}
          emphasis
        />
        <Metric
          label="Pedidos a preparar"
          value={String(metrics.ordersPending)}
          note={metrics.ordersPending > 0 ? 'Requieren acción' : 'Todo al día'}
        />
        <Metric
          label="Espectadores (7 días)"
          value={viewers(metrics.viewersLast7Days)}
          note="Vistas de tus vivos"
        />
        <Metric
          label="Conversión"
          value={`${(metrics.conversionBps / 100).toFixed(1)} %`}
          note="Pedidos por espectador"
        />
      </section>

      {/* --- Next scheduled ----------------------------------------------------- */}
      {metrics.nextLive ? (
        <section className="px-4">
          <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3.5">
            <CalendarIcon className="size-5 shrink-0 text-subtle" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-subtle">
                Próximo live
              </p>
              <p className="truncate text-[15px] font-bold">{metrics.nextLive.title}</p>
              <p className="text-[13px] text-subtle">
                {scheduleLabel(metrics.nextLive.scheduledAt)} ·{' '}
                {metrics.nextLive.productCount} productos
              </p>
            </div>
            <Link
              href={`/transmitir/${metrics.nextLive.id}`}
              className={buttonClasses({ size: 'sm', className: 'shrink-0 text-[13px]' })}
            >
              Abrir
            </Link>
          </div>
        </section>
      ) : null}

      {/* --- Orders needing action ------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3 px-4">
          <h2 className="text-[17px] font-extrabold tracking-tight">Pedidos pagos</h2>
          <Link
            href="/vender/pedidos"
            className="inline-flex items-center gap-0.5 text-[13px] font-bold text-ink-soft"
          >
            Ver todos
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>

        {orders.length === 0 ? (
          <p className="mx-4 rounded-2xl bg-muted px-4 py-6 text-center text-[14px] text-subtle">
            No hay pedidos esperando preparación.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 px-4">
            {orders.slice(0, 4).map((order) => (
              <li key={order.id}>
                <Link
                  href="/vender/pedidos"
                  className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card"
                >
                  <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {order.items[0]?.imageUrl ? (
                      <img src={order.items[0].imageUrl} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">
                      {order.items[0]?.title}
                    </span>
                    <span className="block text-[12px] text-subtle">{order.code}</span>
                  </span>
                  <Badge tone="info">Pagado</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 pb-2">
        <Link
          href="/vender/productos"
          className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3.5 transition-colors hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">
              {metrics.productsActive} productos publicados
            </p>
            <p className="text-[13px] text-subtle">Gestionar catálogo y stock</p>
          </div>
          <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
        </Link>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={[
        'flex flex-col gap-0.5 rounded-3xl p-4',
        emphasis ? 'bg-ink text-surface' : 'bg-surface shadow-card',
      ].join(' ')}
    >
      <p
        className={[
          'text-[11px] font-bold uppercase tracking-wide',
          emphasis ? 'text-surface/60' : 'text-subtle',
        ].join(' ')}
      >
        {label}
      </p>
      <p className="text-[22px] font-extrabold leading-tight tracking-tight">{value}</p>
      {note ? (
        <p className={['text-[12px]', emphasis ? 'text-surface/70' : 'text-subtle'].join(' ')}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
