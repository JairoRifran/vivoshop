import { isApiError } from '@vivo/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeftIcon } from '@/components/icons';
import { ProductForm } from '@/components/seller/product-form';
import { api } from '@/lib/api';

export const metadata: Metadata = { title: 'Editar producto' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await api();

  let product;
  try {
    product = await client.products.byId(id);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-safe">
      <header className="flex items-center gap-2 pt-3">
        <Link
          href="/vender/productos"
          aria-label="Volver a productos"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <h1 className="truncate text-[20px] font-extrabold tracking-tight">{product.title}</h1>
      </header>

      <ProductForm product={product} />
    </div>
  );
}
