import { Badge, buttonClasses, LiveDot } from '@vivo/ui';
import Link from 'next/link';
import { VivoWordmark } from '@/components/brand';
import { LiveCard, LiveRowCard, ProductCard, StoreBubble } from '@/components/cards';
import { BroadcastIcon, ChevronRightIcon, SearchIcon } from '@/components/icons';
import { Rail, Section } from '@/components/section';
import { api, getCurrentUser, safe } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Home is a discovery surface, not a catalogue.
 *
 * The order is deliberate, and it is two questions in sequence: *what is
 * happening now* (live, offers) and then *what is there* (stores you follow,
 * what is coming, who else sells, the rest of the catalogue). A grid of
 * products first would make this look like every other shop and bury the one
 * thing that makes it different.
 *
 * Todo lo que se muestra dos veces se resta en vez de sumar: las ofertas salen
 * de "Se está vendiendo", y las tiendas que ya seguís salen de "Tiendas". Un
 * inicio con poco contenido se nota más si lo repite.
 *
 * Every rail is fetched here in one pass rather than behind its own Suspense
 * boundary. See `docs/m01.md` — per-section streaming does not resolve under
 * Next 16's dev server, and a home page that only works in production is not
 * a home page. Route-level `loading.tsx` still covers the navigation state.
 */
export default async function HomePage() {
  const [client, user] = await Promise.all([api(), getCurrentUser()]);

  const [liveNow, upcoming, products, following, stores] = await Promise.all([
    safe(client.live.list({ status: 'live', limit: 12 }), []),
    safe(client.live.list({ status: 'scheduled', limit: 8 }), []),
    safe(client.products.featured({ limit: 12 }), []),
    user ? safe(client.stores.following(), []) : Promise.resolve([]),
    safe(client.stores.list({ limit: 12 }), []),
  ]);

  /*
   * Las ofertas salen de los mismos productos, no de una consulta aparte.
   *
   * `discountPercent` ya viene calculado por la API, así que ordenar por
   * descuento es gratis acá y no justifica un endpoint nuevo mientras el
   * catálogo entre en una sola página. El día que no entre, esto se convierte
   * en `GET /products?sort=discount` y la pantalla no cambia.
   */
  const rebajados = products
    .filter((product) => (product.discountPercent ?? 0) > 0)
    .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));

  /*
   * Hacen falta dos para que sea una fila.
   *
   * Con una sola oferta la sección se ve rota: un título, un "Ver todo" y una
   * tarjeta suelta con medio ancho de pantalla vacío al lado. Por debajo del
   * umbral el producto se queda en la grilla, donde `ProductCard` igual le
   * muestra el "-N%": la oferta no se pierde, solo no se le arma una sección.
   */
  const ofertas = rebajados.length >= 2 ? rebajados : [];

  /*
   * Lo que no está en la fila de ofertas. Sin esto las dos secciones mostrarían
   * los mismos productos, y un inicio que repite el mismo artículo dos veces se
   * ve más vacío que uno que lo muestra una sola.
   */
  const resto =
    ofertas.length > 0 ? products.filter((product) => !(product.discountPercent ?? 0)) : products;

  // Misma regla para las tiendas: las que ya seguís tienen su propia fila.
  const seguidas = new Set(following.map((store) => store.id));
  const otrasTiendas = stores.filter((store) => !seguidas.has(store.id));

  return (
    <div className="flex flex-col gap-8 pt-safe">
      <header className="flex items-center justify-between gap-3 px-4 pt-2">
        <div>
          <p className="text-[13px] font-semibold text-subtle">Ventas en vivo · Uruguay</p>
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
        /*
         * Sin vivos esto era un `EmptyState`: una caja centrada, alta, gris,
         * arriba de todo. Ocupaba la mejor parte de la pantalla para decir que
         * no había nada, y empujaba abajo del pliegue lo que sí había.
         *
         * Una banda de una fila dice lo mismo en un quinto del alto. Y en vez
         * de mandar a "explorar" a secas propone seguir tiendas, que es la
         * acción que hace que la próxima vez esta sección no esté vacía: las
         * notificaciones push de M05 avisan cuando una tienda seguida sale.
         */
        <div className="px-4">
          <Link
            href="/explorar"
            className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-live/10 text-live">
              <BroadcastIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold leading-snug">
                Ahora no hay nadie en vivo
              </span>
              <span className="block text-[13px] leading-snug text-subtle">
                Seguí las tiendas que te gusten y te avisamos cuando salgan.
              </span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
          </Link>
        </div>
      )}

      {ofertas.length > 0 ? (
        <Section title="Ofertas" subtitle="Lo que está rebajado hoy" href="/explorar">
          <Rail>
            {ofertas.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                showSaving
                className="w-38 shrink-0"
              />
            ))}
          </Rail>
        </Section>
      ) : null}

      {/*
        La invitación a crear cuenta baja después de las ofertas.
        Estaba en tercer lugar, antes de cualquier producto: pedía el registro
        a alguien que todavía no había visto nada por lo cual registrarse.
      */}
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

      {/*
        Tiendas: contenido que el inicio nunca mostraba.
        Hasta ahora la única forma de ver una tienda desde acá era seguirla
        primero, que es al revés de como pasa: primero la ves, después la seguís.
      */}
      {otrasTiendas.length > 0 ? (
        <Section title="Tiendas" subtitle="Quiénes están vendiendo" href="/explorar">
          <Rail>
            {otrasTiendas.map((store) => (
              <StoreBubble key={store.id} store={store} />
            ))}
          </Rail>
        </Section>
      ) : null}

      {/*
        El subtítulo decía "Productos que pasaron por un vivo esta semana", y no
        es lo que se muestra: `products.featured()` es `GET /products`, y
        `ProductQuery` no tiene ni filtro por vivo ni por fecha —solo tienda,
        estado, texto y límite—. Era una afirmación que el endpoint desmiente.
      */}
      {resto.length > 0 ? (
        <Section title="Se está vendiendo" subtitle="Del catálogo de las tiendas" href="/explorar">
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-4 sm:grid-cols-3 lg:grid-cols-4">
            {resto.map((product) => (
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
          <span className="text-xs font-extrabold uppercase tracking-widest">
            Seguí tus tiendas
          </span>
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
      <Link href="/vender" className={buttonClasses({ size: 'md', className: 'shrink-0 text-sm' })}>
        Empezar
      </Link>
    </div>
  );
}
