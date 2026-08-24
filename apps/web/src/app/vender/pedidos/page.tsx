import type { Metadata } from 'next';
import { SellerOrderList } from '@/components/seller/order-list';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Pedidos' };
export const dynamic = 'force-dynamic';

export default async function SellerOrdersPage() {
  const client = await api();
  const orders = await safe(client.orders.sellerList(), []);

  return (
    <div className="flex flex-col gap-5 pt-safe">
      <header className="px-4 pt-3">
        <h1 className="text-[24px] font-extrabold tracking-tight">Pedidos</h1>
        <p className="text-[13px] text-subtle">{orders.length} en total</p>
      </header>

      <SellerOrderList orders={orders} />
    </div>
  );
}
