import { ORDER_TIMELINE, type OrderStatus } from '@vivo/domain';
import type { OrderDto } from '@vivo/shared';
import { cn } from '@vivo/ui';
import { dateTime, timelineLabel } from '@/lib/format';

/**
 * Order progress.
 *
 * Cancelled is not a stage on the happy path, so it renders as its own state
 * rather than as a red step wedged into the middle of a five-step rail.
 */
export function OrderTimeline({ order }: { order: OrderDto }) {
  const reached = new Map(order.timeline.map((event) => [event.status, event.at]));

  if (order.status === 'cancelled') {
    const at = reached.get('cancelled');
    return (
      <div className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3">
        <p className="text-[15px] font-bold text-danger">Pedido cancelado</p>
        {at ? <p className="text-[13px] text-subtle">{dateTime(at)}</p> : null}
      </div>
    );
  }

  const currentIndex = ORDER_TIMELINE.indexOf(order.status);

  return (
    <ol className="flex flex-col">
      {ORDER_TIMELINE.map((status: OrderStatus, index) => {
        const done = index <= currentIndex;
        const current = index === currentIndex;
        const at = reached.get(status);
        const last = index === ORDER_TIMELINE.length - 1;

        return (
          <li key={status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                  done ? 'border-brand bg-brand text-white' : 'border-line bg-surface',
                  current && 'ring-4 ring-ink/10',
                )}
              >
                {done ? (
                  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="m5 10.5 3.5 3.5L15 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              {!last ? (
                <span
                  aria-hidden
                  className={cn('w-0.5 flex-1', index < currentIndex ? 'bg-brand' : 'bg-line')}
                />
              ) : null}
            </div>

            <div className={cn('pb-5', last && 'pb-0')}>
              <p
                className={cn(
                  'text-[15px] leading-tight',
                  current ? 'font-extrabold text-ink' : done ? 'font-semibold text-ink-soft' : 'text-subtle',
                )}
              >
                {timelineLabel(status, order.delivery.kind)}
                {current ? <span className="sr-only"> (estado actual)</span> : null}
              </p>
              {at ? <p className="text-[13px] text-subtle">{dateTime(at)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
