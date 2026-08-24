import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SellerNav } from '@/components/seller/seller-nav';
import { api, getCurrentUser, safe } from '@/lib/api';

export const metadata: Metadata = { title: { default: 'Seller Center', template: '%s · Vender' } };
export const dynamic = 'force-dynamic';

/**
 * Seller Center shell.
 *
 * Deliberately a different world from the buyer app: dark chrome, denser
 * information, its own navigation. A seller must never wonder which mode they
 * are in, and on desktop this widens far past the buyer's phone-shaped column
 * because managing a catalogue is a two-hand job.
 */
export default async function SellerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fvender');

  const client = await api();
  const store = await safe(client.stores.mine(), null);

  // No store yet: onboarding owns the whole screen, with no navigation to a
  // Seller Center that does not exist for this account.
  if (!store) {
    return (
      <div className="mx-auto min-h-dvh w-full max-w-2xl bg-canvas">
        <main id="contenido">{children}</main>
      </div>
    );
  }

  const sessions = await safe(client.live.listMine(), []);
  const active = sessions.find((session) => session.status === 'live') ?? null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-canvas lg:max-w-6xl">
      <main id="contenido" className="flex-1 pb-nav">
        {children}
      </main>
      <SellerNav liveSessionId={active?.id ?? null} />
    </div>
  );
}
