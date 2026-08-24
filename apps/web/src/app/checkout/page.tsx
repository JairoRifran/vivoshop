import { getMarket } from '@vivo/config';
import { isApiError } from '@vivo/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CheckoutForm } from '@/components/checkout-form';
import { ChevronLeftIcon } from '@/components/icons';
import { api, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Finalizar compra' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  producto?: string;
  variante?: string;
  cantidad?: string;
  vivo?: string;
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { producto, variante, cantidad, vivo } = await searchParams;
  if (!producto || !variante) notFound();

  const self = `/checkout?producto=${producto}&variante=${variante}&cantidad=${cantidad ?? 1}${
    vivo ? `&vivo=${vivo}` : ''
  }`;

  const user = await getCurrentUser();
  if (!user) redirect(`/ingresar?next=${encodeURIComponent(self)}`);

  const client = await api();

  let product;
  try {
    product = await client.products.byId(producto);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    throw error;
  }

  const store = await client.stores.bySlug(product.storeSlug);
  const market = getMarket(store.country);
  const quantity = Math.min(99, Math.max(1, Number(cantidad ?? 1) || 1));

  const firstDelivery =
    market.delivery.find((method) => store.deliveryMethodIds.includes(method.id)) ??
    market.delivery[0];

  if (!firstDelivery) notFound();

  const preview = await client.orders.preview(store.id, {
    lines: [{ productId: product.id, variantId: variante, quantity }],
    deliveryMethodId: firstDelivery.id,
    installments: 1,
  });

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-canvas">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-canvas/95 px-3 pt-safe backdrop-blur-lg">
        <Link
          href={vivo ? `/live/${vivo}` : `/producto/${product.id}`}
          aria-label="Volver"
          className="grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <h1 className="py-3 text-[17px] font-extrabold tracking-tight">Finalizar compra</h1>
      </header>

      <main id="contenido" className="flex-1 px-4 pt-5">
        <CheckoutForm
          product={product}
          variantId={variante}
          quantity={quantity}
          store={store}
          user={user}
          delivery={[...market.delivery]}
          payment={[...market.payment]}
          regions={[...market.address.regions]}
          initialPreview={preview}
          liveSessionId={vivo ?? null}
        />
      </main>
    </div>
  );
}
