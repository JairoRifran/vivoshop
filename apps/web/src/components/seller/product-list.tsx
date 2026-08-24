'use client';

import type { ProductSummaryDto } from '@vivo/shared';
import { Badge, EmptyState, cn } from '@vivo/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { BoxIcon, SearchIcon } from '@/components/icons';
import { toggleProduct } from '@/lib/actions/seller';
import { money } from '@/lib/format';

/**
 * Catalogue management.
 *
 * Filtering happens on the client because a seller's catalogue is small and an
 * instant filter beats a round trip; publishing still goes through the server
 * action so stock and status stay authoritative.
 */
export function SellerProductList({ products }: { products: ProductSummaryDto[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todos' | 'active' | 'paused'>('todos');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products
      .filter((product) => (filter === 'todos' ? true : product.status === filter))
      .filter((product) => (needle ? product.title.toLowerCase().includes(needle) : true));
  }, [products, query, filter]);

  const toggle = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      await toggleProduct(id);
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative px-4">
        <label htmlFor="buscar-productos" className="sr-only">
          Buscar en tu catálogo
        </label>
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-8 top-1/2 size-5 -translate-y-1/2 text-subtle"
        />
        <input
          id="buscar-productos"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar producto"
          className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-[16px] focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
        />
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        {(
          [
            ['todos', `Todos (${products.length})`],
            ['active', `Publicados (${products.filter((p) => p.status === 'active').length})`],
            ['paused', `Pausados (${products.filter((p) => p.status === 'paused').length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={cn(
              'inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-bold transition-colors',
              filter === value ? 'bg-ink text-surface' : 'bg-surface text-ink-soft shadow-card',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="px-4">
          <EmptyState
            icon={<BoxIcon className="size-8" />}
            title={query ? 'Sin resultados' : 'Todavía no cargaste productos'}
            description={
              query
                ? 'Probá con otro nombre.'
                : 'Cargá el primero para poder mostrarlo en un vivo.'
            }
            action={
              !query ? (
                <Link
                  href="/vender/productos/nuevo"
                  className="inline-flex h-11 items-center rounded-2xl bg-ink px-5 text-sm font-bold text-surface"
                >
                  Nuevo producto
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {visible.map((product) => (
            <li
              key={product.id}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card"
            >
              <Link
                href={`/vender/productos/${product.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {product.image ? (
                    <img src={product.image.url} alt="" className="size-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{product.title}</span>
                  <span className="block text-[14px] font-semibold">
                    {money(product.priceMinor, product.currency)}
                  </span>
                  <span
                    className={cn(
                      'block text-[12px]',
                      product.stock === 0 ? 'font-bold text-danger' : 'text-subtle',
                    )}
                  >
                    {product.stock === 0 ? 'Sin stock' : `${product.stock} en stock`}
                  </span>
                </span>
              </Link>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge tone={product.status === 'active' ? 'success' : 'neutral'}>
                  {product.status === 'active' ? 'Publicado' : 'Pausado'}
                </Badge>
                <button
                  type="button"
                  onClick={() => toggle(product.id)}
                  disabled={busyId === product.id}
                  aria-label={
                    product.status === 'active'
                      ? `Pausar ${product.title}`
                      : `Publicar ${product.title}`
                  }
                  className="rounded-lg px-2 py-1 text-[12px] font-bold text-ink-soft underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
                >
                  {busyId === product.id
                    ? '...'
                    : product.status === 'active'
                      ? 'Pausar'
                      : 'Publicar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
