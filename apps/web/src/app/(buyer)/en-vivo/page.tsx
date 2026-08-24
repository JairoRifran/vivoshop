import { Badge, EmptyState, LiveDot } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRowCard } from '@/components/cards';
import { BroadcastIcon } from '@/components/icons';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'En vivo' };
export const dynamic = 'force-dynamic';

export default async function LiveIndexPage() {
  const client = await api();
  const [live, scheduled, ended] = await Promise.all([
    safe(client.live.list({ status: 'live', limit: 20 }), []),
    safe(client.live.list({ status: 'scheduled', limit: 20 }), []),
    safe(client.live.list({ status: 'ended', limit: 6 }), []),
  ]);

  return (
    <div className="flex flex-col gap-7 pt-safe">
      <header className="flex flex-col gap-1 px-4 pt-2">
        <div className="flex items-center gap-2 text-live">
          <LiveDot />
          <span className="text-xs font-extrabold uppercase tracking-widest">
            {live.length > 0 ? `${live.length} transmitiendo` : 'Sin transmisiones'}
          </span>
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight">En vivo</h1>
      </header>

      {live.length > 0 ? (
        <section className="flex flex-col gap-3 px-4">
          {live.map((session) => (
            <LiveRowCard key={session.id} session={session} />
          ))}
        </section>
      ) : (
        <div className="px-4">
          <EmptyState
            icon={<BroadcastIcon className="size-8" />}
            title="Ahora mismo no hay vivos"
            description="Mirá los que están programados o seguí tiendas para que te avisemos."
            action={
              <Link
                href="/explorar"
                className="text-sm font-bold text-ink underline underline-offset-4"
              >
                Explorar tiendas
              </Link>
            }
          />
        </div>
      )}

      {scheduled.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="px-4 text-[19px] font-extrabold tracking-tight">Programados</h2>
          <div className="flex flex-col gap-3 px-4">
            {scheduled.map((session) => (
              <LiveRowCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}

      {ended.length > 0 ? (
        <section className="flex flex-col gap-3 pb-2">
          <div className="flex items-center gap-2 px-4">
            <h2 className="text-[19px] font-extrabold tracking-tight">Terminados</h2>
            <Badge tone="neutral">Repaso</Badge>
          </div>
          <div className="flex flex-col gap-3 px-4 opacity-80">
            {ended.map((session) => (
              <LiveRowCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
