import { isApiError } from '@vivo/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveConsole } from '@/components/seller/live-console';
import { realtimeToken } from '@/lib/actions/social';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Transmitir' };
export const dynamic = 'force-dynamic';

/**
 * The broadcast console takes over the whole screen, so it opts out of the
 * seller shell padding by rendering its own full-height layout.
 */
export default async function LiveConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await api();

  let session;
  try {
    session = await client.live.byId(id);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    throw error;
  }

  const [stats, messages, socketToken] = await Promise.all([
    client.live.stats(id),
    safe(client.live.messages(id, { limit: 50 }), []),
    realtimeToken(),
  ]);

  return (
    <LiveConsole
      session={session}
      initialStats={stats}
      initialMessages={messages}
      realtimeToken={socketToken}
    />
  );
}
