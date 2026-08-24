'use client';

import { nextOrderStatuses, type OrderStatus } from '@vivo/domain';
import type { OrderDto } from '@vivo/shared';
import { Badge, Button, EmptyState, cn } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { TruckIcon } from '@/components/icons';
import { advanceOrder } from '@/lib/actions/seller';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, dateTime, money, timelineLabel } from '@/lib/format';

const FILTERS: Array<{ value: OrderStatus | 'todos'; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'paid', label: 'Pagados' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'shipped', label: 'Enviados' },
  { value: 'delivered', label: 'Entregados' },
];

/**
 * Order fulfilment.
 *
 * The action buttons come from `nextOrderStatuses` in the domain, so the UI
 * can never offer a transition the API would reject. Adding a status to the
 * state machine surfaces it here automatically.
 */
export function SellerOrderList({ orders }: { orders: OrderDto[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<OrderStatus | 'todos'>('todos');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(
    () => (filter === 'todos' ? orders : orders.filter((order) => order.status === filter)),
    [orders, filter],
  );

  const advance = (orderId: string, status: OrderStatus) => {
    setBusyId(orderId);
    setError(null);
    startTransition(async () => {
      const result = await advanceOrder(orderId, status);
      setBusyId(null);
      if (result.status === 'error') setError(result.message ?? 'No pudimos actualizar el pedido.');
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((item) => {
          const count =
            item.value === 'todos'
              ? orders.length
              : orders.filter((order) => order.status === item.value).length;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              aria-pressed={filter === item.value}
              className={cn(
                'inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors',
                filter === item.value
                  ? 'bg-ink text-surface'
                  : 'bg-surface text-ink-soft shadow-card',
              )}
            >
              {item.label} ({count})
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mx-4 rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <div className="px-4">
          <EmptyState
            icon={<TruckIcon className="size-8" />}
            title="No hay pedidos en este estado"
            description="Cuando alguien compre en tu vivo, el pedido aparece acá."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3 px-4">
          {visible.map((order) => {
            const next = nextOrderStatuses(order.status);
            const advanceable = next.filter((status) => status !== 'cancelled');
            const cancellable = next.includes('cancelled');
            const units = order.items.reduce((total, item) => total + item.quantity, 0);

            return (
              <li key={order.id} className="flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-subtle">
                      {order.code} · {dateTime(order.createdAt)}
                    </p>
                    <p className="truncate text-[15px] font-bold">
                      {order.items[0]?.title}
                      {order.items.length > 1 ? ` +${order.items.length - 1}` : ''}
                    </p>
                    <p className="text-[13px] text-subtle">
                      {units} {units === 1 ? 'unidad' : 'unidades'} ·{' '}
                      {money(order.totalMinor, order.currency)}
                    </p>
                  </div>
                  <Badge tone={ORDER_STATUS_TONE[order.status]}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </Badge>
                </div>

                <div className="flex items-start gap-2 rounded-2xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed">
                  <TruckIcon className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <div className="min-w-0">
                    <p className="font-semibold">{order.delivery.label}</p>
                    {order.delivery.address ? (
                      <p className="text-subtle">
                        {order.delivery.address.recipientName} · {order.delivery.address.street},{' '}
                        {order.delivery.address.locality}, {order.delivery.address.regionName}
                      </p>
                    ) : (
                      <p className="text-subtle">Sin envío: {order.delivery.estimate}</p>
                    )}
                    {order.buyerNote ? (
                      <p className="pt-1 italic text-ink-soft">“{order.buyerNote}”</p>
                    ) : null}
                  </div>
                </div>

                {next.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {advanceable.map((status) => (
                      <Button
                        key={status}
                        size="md"
                        loading={busyId === order.id}
                        onClick={() => advance(order.id, status)}
                      >
                        Marcar como {timelineLabel(status, order.delivery.kind).toLowerCase()}
                      </Button>
                    ))}
                    {cancellable ? (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => advance(order.id, 'cancelled')}
                        className="px-2 py-1 text-[13px] font-semibold text-subtle underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
