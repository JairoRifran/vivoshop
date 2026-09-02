import type { StoreCategory } from '@vivo/domain';
import { EmptyState } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductCard, StoreRow } from '@/components/cards';
import { SearchField } from '@/components/search-field';
import { Section } from '@/components/section';
import { api, safe } from '@/lib/api';
import { STORE_CATEGORY_LABEL } from '@/lib/format';

export const metadata: Metadata = { title: 'Explorar' };
export const dynamic = 'force-dynamic';

const CATEGORIES: Array<{ value: StoreCategory | 'todas'; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'moda', label: 'Moda' },
  { value: 'belleza', label: 'Belleza' },
  { value: 'hogar', label: 'Hogar' },
  { value: 'coleccionables', label: 'Coleccionables' },
  { value: 'tecnologia', label: 'Tecnología' },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoria?: string }>;
}) {
  const { q, categoria } = await searchParams;
  const search = q?.trim() ?? '';
  const category = categoria && categoria !== 'todas' ? (categoria as StoreCategory) : undefined;

  const client = await api();
  const [stores, products] = await Promise.all([
    safe(
      client.stores.list({
        ...(category ? { category } : {}),
        ...(search ? { search } : {}),
        limit: 20,
      }),
      [],
    ),
    safe(client.products.featured({ ...(search ? { search } : {}), limit: 24 }), []),
  ]);

  const hasResults = stores.length > 0 || products.length > 0;

  return (
    <div className="flex flex-col gap-7 pt-safe">
      <header className="flex flex-col gap-4 px-4 pt-2">
        <h1 className="text-[26px] font-extrabold tracking-tight">Explorar</h1>
        <SearchField defaultValue={search} />
      </header>

      <nav aria-label="Categorías" className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        {CATEGORIES.map((item) => {
          const active =
            item.value === 'todas' ? !categoria || categoria === 'todas' : categoria === item.value;
          const params = new URLSearchParams();
          if (search) params.set('q', search);
          if (item.value !== 'todas') params.set('categoria', item.value);

          return (
            <Link
              key={item.value}
              href={`/explorar${params.size > 0 ? `?${params.toString()}` : ''}`}
              aria-current={active ? 'true' : undefined}
              className={[
                'inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-bold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                active
                  ? 'bg-brand text-white'
                  : 'bg-surface text-ink-soft shadow-card hover:bg-muted',
              ].join(' ')}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {!hasResults ? (
        <div className="px-4">
          <EmptyState
            title={search ? `Sin resultados para "${search}"` : 'Todavía no hay nada por acá'}
            description="Probá con otra palabra o mirá las tiendas que están transmitiendo ahora."
            action={
              <Link
                href="/en-vivo"
                className="text-sm font-bold text-ink underline underline-offset-4"
              >
                Ver quién está en vivo
              </Link>
            }
          />
        </div>
      ) : null}

      {stores.length > 0 ? (
        <Section
          title="Tiendas"
          subtitle={
            category ? STORE_CATEGORY_LABEL[category] : `${stores.length} tiendas disponibles`
          }
        >
          <div className="flex flex-col divide-y divide-line px-4">
            {stores.map((store) => (
              <StoreRow key={store.id} store={store} />
            ))}
          </div>
        </Section>
      ) : null}

      {products.length > 0 ? (
        <Section title="Productos">
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
