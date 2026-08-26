import { randomUUID } from 'node:crypto';
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
  /**
   * La oferta aceptada que trae a esta persona acá.
   *
   * Viaja el id y nunca el monto: el precio lo resuelve el servidor leyendo la
   * oferta. Si el monto viniera en la URL, cualquiera compraría al precio que
   * escribiera en la barra de direcciones.
   */
  oferta?: string;
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { producto, variante, cantidad, vivo, oferta } = await searchParams;
  if (!producto || !variante) notFound();

  const self =
    `/checkout?producto=${producto}&variante=${variante}&cantidad=${cantidad ?? 1}` +
    `${vivo ? `&vivo=${vivo}` : ''}${oferta ? `&oferta=${oferta}` : ''}`;

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

  /**
   * Con una oferta aceptada, la vista previa se pide con su id.
   *
   * El servidor la lee, verifica que sea de quien está comprando y usa su
   * importe. Así el número que se ve acá sale del mismo lugar que el que se va
   * a cobrar, en vez de ser una segunda cuenta que puede diferir.
   */
  const line = {
    productId: product.id,
    variantId: variante,
    quantity,
    ...(oferta ? { bidId: oferta } : {}),
  };

  /**
   * Si esta puja ya se compró, se va al pedido en vez de mostrar un error.
   *
   * Pasa sin que nadie haga nada raro: se paga, se vuelve atrás con el botón
   * del navegador, y esta pantalla se rinde de nuevo. Antes reventaba —una
   * pantalla de error después de una compra que salió bien, que es de las
   * peores cosas que puede ver alguien que acaba de pagar—.
   *
   * `redirect` lanza, así que el destino se guarda y se salta fuera del
   * `catch`; adentro, el propio `catch` se lo comería.
   */
  let preview: Awaited<ReturnType<typeof client.orders.preview>>;
  let alreadyOrdered: string | null = null;
  try {
    preview = await client.orders.preview(store.id, {
      lines: [line],
      deliveryMethodId: firstDelivery.id,
      installments: 1,
    });
  } catch (error) {
    if (!isApiError(error) || error.code !== 'BID_ALREADY_ORDERED') throw error;
    const orderId = error.details.orderId;
    alreadyOrdered = typeof orderId === 'string' ? `/compras/${orderId}` : '/compras';
    preview = null as never;
  }

  if (alreadyOrdered) redirect(alreadyOrdered);

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
          bidId={oferta ?? null}
          /* Una por carga de pantalla: los reintentos de *este* checkout la
             comparten, y abrir el checkout de nuevo empieza de cero. */
          idempotencyKey={`chk-${randomUUID()}`}
        />
      </main>
    </div>
  );
}
