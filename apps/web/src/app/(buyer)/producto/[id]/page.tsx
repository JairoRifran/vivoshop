import { isApiError } from '@vivo/shared';
import { Avatar } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConnectionError } from '@/components/connection-error';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { ProductPanel } from '@/components/product-panel';
import { VerifiedBadge } from '@/components/verified-badge';
import { api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const client = await api();
    const product = await client.products.byId(id);
    return { title: product.title, description: product.description.slice(0, 150) };
  } catch {
    return { title: 'Producto' };
  }
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vivo?: string }>;
}) {
  const [{ id }, { vivo }] = await Promise.all([params, searchParams]);
  const client = await api();

  let product;
  try {
    product = await client.products.byId(id);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    // Un fallo de red no es un 404 ni un error de la aplicación: la API se
    // está reiniciando o la conexión se cortó. Cualquier otra cosa sí sube,
    // porque es un bug y tiene que verse en los logs.
    if (isApiError(error) && error.isOffline) return <ConnectionError />;
    throw error;
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-safe">
      <div className="flex items-center gap-2 pt-2">
        <Link
          href={`/tienda/${product.storeSlug}`}
          aria-label="Volver a la tienda"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <span className="text-sm font-semibold text-subtle">Producto</span>
      </div>

      <ProductPanel product={product} {...(vivo ? { liveSessionId: vivo } : {})} />

      <Link
        href={`/tienda/${product.storeSlug}`}
        className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Avatar name={product.storeName} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[15px] font-bold">
            <span className="truncate">{product.storeName}</span>
            {product.storeIsVerified ? <VerifiedBadge size="sm" /> : null}
          </p>
          <p className="text-[13px] text-subtle">Ver toda la tienda</p>
        </div>
        <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
      </Link>
    </div>
  );
}
