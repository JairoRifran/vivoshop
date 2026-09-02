import { isApiError } from '@vivo/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConnectionError } from '@/components/connection-error';
import { LiveViewer } from '@/components/live/live-viewer';
import { realtimeToken } from '@/lib/actions/social';
import { api, getCurrentUser, safe } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const client = await api();
    const session = await client.live.byId(id);
    const title = `${session.store.name} en vivo`;
    // A live is shared as a link in WhatsApp before it is found any other way,
    // so the preview card is the actual entry point to the product.
    const images = session.thumbnailUrl ? [{ url: session.thumbnailUrl }] : [];

    return {
      title,
      description: session.title,
      openGraph: {
        type: 'video.other',
        title,
        description: session.title,
        siteName: 'VivoShop',
        images,
      },
      twitter: {
        card: images.length > 0 ? 'summary_large_image' : 'summary',
        title,
        description: session.title,
      },
    };
  } catch {
    return { title: 'En vivo' };
  }
}

/**
 * The live route sits outside the buyer layout on purpose: no bottom nav, no
 * page chrome, no max-width. It is a full-screen surface, and anything that
 * frames it would break the illusion.
 */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await api();

  let session;
  try {
    session = await client.live.byId(id);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    if (isApiError(error) && error.isOffline) {
      return (
        <ConnectionError hint="No pudimos cargar la transmisión. Probá de nuevo en unos segundos." />
      );
    }
    throw error;
  }

  const [messages, bids, user, socketToken] = await Promise.all([
    safe(client.live.messages(id, { limit: 40 }), []),
    // Las pujas entran en la primera pintada: si se pidieran después, quien
    // abre el vivo durante una puja vería medio segundo sin ella.
    safe(client.bids.forLive(id), []),
    getCurrentUser(),
    // Minted server-side: the session cookie stays httpOnly, and this token is
    // only accepted by the realtime gateway.
    realtimeToken(),
  ]);

  return (
    <LiveViewer
      session={session}
      initialMessages={messages}
      initialBids={bids}
      signedIn={Boolean(user)}
      realtimeToken={socketToken}
    />
  );
}
