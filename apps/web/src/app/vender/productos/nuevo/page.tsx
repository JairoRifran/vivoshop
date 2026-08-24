import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeftIcon } from '@/components/icons';
import { ProductForm } from '@/components/seller/product-form';

export const metadata: Metadata = { title: 'Nuevo producto' };

export default function NewProductPage() {
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
        <h1 className="text-[20px] font-extrabold tracking-tight">Nuevo producto</h1>
      </header>

      <ProductForm />
    </div>
  );
}
