import type { Metadata } from 'next';
import Link from 'next/link';
import { PlusIcon } from '@/components/icons';
import { SellerProductList } from '@/components/seller/product-list';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Productos' };
export const dynamic = 'force-dynamic';

export default async function SellerProductsPage() {
  const client = await api();
  const products = await safe(client.products.listMine(), []);

  return (
    <div className="flex flex-col gap-5 pt-safe">
      <header className="flex items-center justify-between gap-3 px-4 pt-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight">Productos</h1>
          <p className="text-[13px] text-subtle">{products.length} en tu catálogo</p>
        </div>
        <Link
          href="/vender/productos/nuevo"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-ink px-4 text-sm font-bold text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <PlusIcon className="size-4" />
          Nuevo
        </Link>
      </header>

      <SellerProductList products={products} />
    </div>
  );
}
