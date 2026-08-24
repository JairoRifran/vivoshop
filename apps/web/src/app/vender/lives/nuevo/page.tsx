import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeftIcon } from '@/components/icons';
import { CreateLiveForm } from '@/components/seller/create-live-form';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Nueva transmisión' };
export const dynamic = 'force-dynamic';

export default async function NewLivePage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string }>;
}) {
  const { modo } = await searchParams;
  const client = await api();
  const products = await safe(client.products.listMine(), []);

  return (
    <div className="flex flex-col gap-5 px-4 pt-safe">
      <header className="flex items-center gap-2 pt-3">
        <Link
          href="/vender"
          aria-label="Volver al panel"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <h1 className="text-[20px] font-extrabold tracking-tight">Nueva transmisión</h1>
      </header>

      <CreateLiveForm products={products} defaultMode={modo === 'programar' ? 'scheduled' : 'now'} />
    </div>
  );
}
