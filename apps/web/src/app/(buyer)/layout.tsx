import type { ReactNode } from 'react';
import { BottomNav } from '@/components/bottom-nav';
import { api, safe } from '@/lib/api';

/**
 * Buyer shell. The live badge count is fetched here rather than inside the nav
 * so the nav can stay a small client component and the request is shared by
 * every page under this layout.
 */
export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const client = await api();
  const liveNow = await safe(client.live.list({ status: 'live', limit: 10 }), []);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-canvas lg:max-w-5xl">
      <main id="contenido" className="flex-1 pb-nav">
        {children}
      </main>
      <BottomNav liveCount={liveNow.length} />
    </div>
  );
}
