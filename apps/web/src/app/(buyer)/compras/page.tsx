import type { OrderDto } from '@vivo/shared';
import { Badge, buttonClasses, EmptyState } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BagIcon, ChevronRightIcon } from '@/components/icons';
import { api, getCurrentUser, safe } from '@/lib/api';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, dateTime, money } from '@/lib/format';

export const metadata: Metadata = { title: 'Mis compras' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fcompras');

  const client = await api();
  const orders = await safe(client.orders.mine(), []);

  const open = orders.filter(
    (order) => order.status !== 'delivered' && order.status !== 'cancelled',
  );
  const closed = orders.filter(
    (order) => order.status === 'delivered' || order.status === 'cancelled',
  );

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="px-4 pt-2">
        <h1 className="text-[26px] font-extrabold tracking-tight">Mis compras</h1>
        <p className="text-[15px] text-subtle">Seguí el estado de cada pedido.</p>
      </header>

      {orders.length === 0 ? (
        <div className="px-4">
          <EmptyState
            icon={<BagIcon className="size-8" />}
            title="Todavía no compraste nada"
            description="Cuando compres en un vivo, el pedido aparece acá con su seguimiento."
            action={
              <Link
                href="/en-vivo"
                className={buttonClasses({ size: 'md', className: 'px-5 text-sm' })}
              >
                Ver vivos
              </Link>
            }
          />
        </div>
      ) : null}

      {open.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="px-4 text-[17px] font-extrabold tracking-tight">En curso</h2>
          <ul className="flex flex-col gap-3 px-4">
            {open.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </ul>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section className="flex flex-col gap-3 pb-2">
          <h2 className="px-4 text-[17px] font-extrabold tracking-tight">Historial</h2>
          <ul className="flex flex-col gap-3 px-4">
            {closed.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OrderCard({ order }: { order: OrderDto }) {
  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const first = order.items[0];

  return (
    <li>
      <Link
        href={`/compras/${order.id}`}
        className="flex items-center gap-3 rounded-3xl bg-surface p-3 shadow-card transition-transform active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:active:scale-100"
      >
        <span className="size-16 shrink-0 overflow-hidden rounded-2xl bg-muted">
          {first?.imageUrl ? (
            <img src={first.imageUrl} alt="" className="size-full object-cover" />
          ) : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Badge tone={ORDER_STATUS_TONE[order.status]}>
              {ORDER_STATUS_LABEL[order.status]}
            </Badge>
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-subtle">
              {order.code}
            </span>
          </span>
          <span className="truncate text-[15px] font-bold">
            {first?.title ?? 'Pedido'}
            {units > 1 ? ` +${units - 1}` : ''}
          </span>
          <span className="truncate text-[13px] text-subtle">
            {order.store.name} · {dateTime(order.createdAt)}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[15px] font-extrabold">
            {money(order.totalMinor, order.currency)}
          </span>
          <ChevronRightIcon className="size-5 text-subtle" />
        </span>
      </Link>
    </li>
  );
}
