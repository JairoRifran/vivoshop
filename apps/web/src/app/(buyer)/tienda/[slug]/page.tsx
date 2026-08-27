import { isApiError } from '@vivo/shared';
import { Avatar, Badge, EmptyState, LiveDot } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConnectionError } from '@/components/connection-error';
import { LiveRowCard, ProductCard } from '@/components/cards';
import { FollowButton } from '@/components/follow-button';
import { LiveNotificationsToggle } from '@/components/live-notifications';
import { ChevronLeftIcon, StoreIcon, TruckIcon } from '@/components/icons';
import { VerifiedBadge } from '@/components/verified-badge';
import { api, safe } from '@/lib/api';
import { money, STORE_CATEGORY_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = await api();
    const store = await client.stores.bySlug(slug);
    return { title: store.name, description: store.description };
  } catch {
    return { title: 'Tienda' };
  }
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await api();

  let store;
  try {
    store = await client.stores.bySlug(slug);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    // Un fallo de red no es un 404 ni un error de la aplicación: la API se
    // está reiniciando o la conexión se cortó. Cualquier otra cosa sí sube,
    // porque es un bug y tiene que verse en los logs.
    if (isApiError(error) && error.isOffline) return <ConnectionError />;
    throw error;
  }

  const [products, sessions] = await Promise.all([
    safe(client.stores.products(slug, { limit: 40 }), []),
    safe(client.live.list({ limit: 20 }), []),
  ]);

  const storeSessions = sessions.filter((session) => session.store.id === store.id);
  const liveNow = storeSessions.find((session) => session.status === 'live');
  const upcoming = storeSessions.filter((session) => session.status === 'scheduled');

  return (
    <div className="flex flex-col gap-6">
      <header className="relative">
        <div className="relative h-40 overflow-hidden bg-muted-strong sm:h-52">
          {store.coverUrl ? (
            <img src={store.coverUrl} alt="" className="size-full object-cover" />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-linear-to-t from-canvas to-transparent" />
        </div>

        <Link
          href="/explorar"
          aria-label="Volver"
          className="absolute left-3 top-3 grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <ChevronLeftIcon className="size-5" />
        </Link>

        <div className="-mt-10 flex items-end gap-3 px-4">
          <Avatar
            src={store.logoUrl}
            name={store.name}
            size={76}
            className="ring-4 ring-canvas"
          />
          <div className="flex flex-1 items-center justify-between gap-3 pb-1">
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
                <span className="truncate">{store.name}</span>
                {store.isVerified ? <VerifiedBadge /> : null}
              </h1>
              <p className="truncate text-[13px] text-subtle">
                {STORE_CATEGORY_LABEL[store.category] ?? store.category}
                {store.city ? ` · ${store.city}` : ''}
              </p>
            </div>
            <FollowButton
              storeId={store.id}
              storeName={store.name}
              following={store.isFollowing ?? false}
              size="md"
            />
          </div>

        </div>
      </header>

      {/*
        El interruptor permanente, y solo para quien ya sigue la tienda.

        Fuera del encabezado a propósito: ese encabezado es `sticky`, y un
        control dentro de algo que flota sobre el resto queda tapado por lo que
        pase por debajo. Ofrecerlo a quien no sigue la tienda tampoco tendría
        sentido: sería pedirle que decida sobre algo que todavía no eligió.
      */}
      {store.isFollowing ? (
        <section className="px-4 pt-3">
          <LiveNotificationsToggle
            storeId={store.id}
            storeName={store.name}
            notifyOnLive={store.notifyOnLive ?? true}
          />
        </section>
      ) : null}

      <section className="grid grid-cols-3 gap-2 px-4">
        <Stat label="Reputación" value={`★ ${store.rating.toFixed(1)}`} note={`${store.reviewCount} reseñas`} />
        <Stat label="Seguidores" value={store.followerCount.toLocaleString('es-UY')} />
        <Stat label="Ventas" value={store.salesCount.toLocaleString('es-UY')} />
      </section>

      {store.description ? (
        <p className="px-4 text-pretty text-[15px] leading-relaxed text-ink-soft">
          {store.description}
        </p>
      ) : null}

      <section className="flex flex-wrap gap-2 px-4">
        {store.freeShippingThresholdMinor ? (
          <Badge tone="success">
            <TruckIcon className="size-3.5" />
            Envío gratis desde {money(store.freeShippingThresholdMinor, store.currency)}
          </Badge>
        ) : null}
        {store.pickupInstructions ? (
          <Badge tone="info">
            <StoreIcon className="size-3.5" />
            Retiro disponible
          </Badge>
        ) : null}
        {store.acceptsReturns ? <Badge tone="neutral">Acepta cambios</Badge> : null}
      </section>

      {liveNow ? (
        <section className="px-4">
          <Link
            href={`/live/${liveNow.id}`}
            className="flex items-center gap-3 rounded-3xl bg-ink px-4 py-3 text-surface transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <span className="flex items-center gap-1.5 text-live">
              <LiveDot />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-widest text-live">En vivo</p>
              <p className="truncate text-[15px] font-bold">{liveNow.title}</p>
            </div>
            <span className="shrink-0 rounded-xl bg-surface px-3 py-2 text-sm font-bold text-ink">
              Entrar
            </span>
          </Link>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="px-4 text-[19px] font-extrabold tracking-tight">Próximos vivos</h2>
          <div className="flex flex-col gap-3 px-4">
            {upcoming.map((session) => (
              <LiveRowCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 pb-4">
        <h2 className="px-4 text-[19px] font-extrabold tracking-tight">
          Productos
          <span className="ml-2 text-[15px] font-semibold text-subtle">{products.length}</span>
        </h2>
        {products.length === 0 ? (
          <div className="px-4">
            <EmptyState
              title="Esta tienda todavía no publicó productos"
              description="Seguila para enterarte cuando cargue el primero."
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-surface px-3 py-2.5 text-center shadow-card">
      <p className="text-[17px] font-extrabold leading-tight">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
      {note ? <p className="text-[11px] text-subtle">{note}</p> : null}
    </div>
  );
}
