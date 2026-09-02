import { Badge, buttonClasses, EmptyState, LiveDot } from '@vivo/ui';
import Link from 'next/link';
import { VivoWordmark } from '@/components/brand';
import { LiveCard, LiveRowCard, ProductCard, StoreBubble } from '@/components/cards';
import { BroadcastIcon, SearchIcon } from '@/components/icons';
import { Rail, Section } from '@/components/section';
import { api, getCurrentUser, safe } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Home is a discovery surface, not a catalogue.
 *
 * The order is deliberate: what is happening right now, then the stores you
 * already care about, then what is about to start, and only then products.
 * A grid of products first would make this look like every other shop and
 * bury the one thing that makes it different.
 *
 * Every rail is fetched here in one pass rather than behind its own Suspense
 * boundary. See `docs/m01.md` — per-section streaming does not resolve under
 * Next 16's dev server, and a home page that only works in production is not
 * a home page. Route-level `loading.tsx` still covers the navigation state.
 */
export default async function HomePage() {
  const [client, user] = await Promise.all([api(), getCurrentUser()]);

  const [liveNow, upcoming, products, following] = await Promise.all([
    safe(client.live.list({ status: 'live', limit: 12 }), []),
    safe(client.live.list({ status: 'scheduled', limit: 8 }), []),
    safe(client.products.featured({ limit: 8 }), []),
    user ? safe(client.stores.following(), []) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8 pt-safe">
      <header className="flex items-center justify-between gap-3 px-4 pt-2">
        <div>
          <p className="text-[13px] font-semibold text-subtle">Comercio en vivo · Uruguay</p>
          <h1 className="text-[28px] leading-tight">
            <VivoWordmark markClassName="size-7" />
          </h1>
        </div>
        <Link
          href="/explorar"
          aria-label="Buscar tiendas y productos"
          className="grid size-11 place-items-center rounded-full bg-surface shadow-card transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <SearchIcon className="size-5" />
        </Link>
      </header>

      {liveNow.length > 0 ? (
        <Section
          title="En vivo ahora"
          subtitle={`${liveNow.length} ${liveNow.length === 1 ? 'tienda transmitiendo' : 'tiendas transmitiendo'}`}
          href="/en-vivo"
        >
          <Rail>
            {liveNow.map((session, index) => (
              <LiveCard key={session.id} session={session} priority={index === 0} />
            ))}
          </Rail>
        </Section>
      ) : (
        <Section title="En vivo ahora">
          <div className="px-4">
            <EmptyState
              icon={<BroadcastIcon className="size-8" />}
              title="Nadie está transmitiendo"
              description="Cuando una tienda arranque un vivo, va a aparecer acá primero."
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
        </Section>
      )}

      {!user ? <SignedOutPrompt /> : null}

      {user && following.length > 0 ? (
        <Section title="Tiendas que sigo" href="/perfil" hrefLabel="Gestionar">
          <Rail>
            {following.map((store) => (
              <StoreBubble key={store.id} store={store} />
            ))}
          </Rail>
        </Section>
      ) : null}

      {upcoming.length > 0 ? (
        <Section title="Próximos vivos" subtitle="Agendá los que no te querés perder">
          <div className="flex flex-col gap-3 px-4">
            {upcoming.slice(0, 3).map((session) => (
              <LiveRowCard key={session.id} session={session} />
            ))}
          </div>
        </Section>
      ) : null}

      {products.length > 0 ? (
        <Section
          title="Se está vendiendo"
          subtitle="Productos que pasaron por un vivo esta semana"
          href="/explorar"
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="px-4 pb-2">
        <SellerPitch />
      </div>
    </div>
  );
}

function SignedOutPrompt() {
  return (
    <section className="px-4">
      <div className="flex flex-col gap-3 rounded-3xl bg-ink px-5 py-5 text-surface">
        <div className="flex items-center gap-2 text-live">
          <LiveDot />
          <span className="text-xs font-extrabold uppercase tracking-widest">Seguí tus tiendas</span>
        </div>
        <p className="text-pretty text-[15px] leading-relaxed text-surface/85">
          Creá tu cuenta para seguir tiendas, recibir aviso cuando salen en vivo y ver tus compras
          en un solo lugar.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/crear-cuenta"
            className="inline-flex h-11 items-center rounded-2xl bg-surface px-5 text-sm font-bold text-ink transition-opacity hover:opacity-90"
          >
            Crear cuenta
          </Link>
          <Link
            href="/ingresar"
            className="inline-flex h-11 items-center rounded-2xl border border-surface/25 px-5 text-sm font-bold text-surface transition-colors hover:bg-surface/10"
          >
            Ingresar
          </Link>
        </div>
      </div>
    </section>
  );
}

function SellerPitch() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-3xl border border-line bg-surface px-5 py-4">
      <div className="min-w-0">
        <Badge tone="neutral" className="mb-1.5">
          Para vendedores
        </Badge>
        <p className="text-[15px] font-bold leading-snug">Vendé en vivo desde tu celular</p>
        <p className="text-[13px] text-subtle">Creá tu tienda gratis en dos minutos.</p>
      </div>
      <Link
        href="/vender"
        className={buttonClasses({ size: 'md', className: 'shrink-0 text-sm' })}
      >
        Empezar
      </Link>
    </div>
  );
}
