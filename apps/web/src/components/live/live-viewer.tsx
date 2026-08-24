'use client';

import type { LiveDetailDto, LiveMessageDto, ProductDetailDto } from '@vivo/shared';
import { Avatar, Badge, Button, LiveDot, Sheet, Skeleton, cn } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, EyeIcon, HeartIcon, ShareIcon } from '@/components/icons';
import { ProductPanel } from '@/components/product-panel';
import { viewerCredentials } from '@/lib/actions/social';
import { track } from '@/lib/analytics';
import { money, viewers } from '@/lib/format';
import { useViewerStream, type StreamCredentials } from '@/lib/live-media';
import { useLiveRealtime } from '@/lib/realtime';
import { FollowButton } from '../follow-button';
import { LiveChatComposer, LiveChatOverlay } from './live-chat';
import { VideoStage } from './video-stage';

interface Props {
  session: LiveDetailDto;
  initialMessages: LiveMessageDto[];
  signedIn: boolean;
  realtimeToken: string | null;
}

/**
 * The live viewer.
 *
 * Everything is one full-height layer stack over the video: chrome on top,
 * chat and the product bar at the bottom, reactions on the right rail. The
 * layout is driven by `dvh` and the safe-area insets so it survives the
 * browser toolbar collapsing on scroll, which is what makes most mobile web
 * players feel broken.
 */
export function LiveViewer({ session: initial, initialMessages, signedIn, realtimeToken }: Props) {
  const router = useRouter();

  const [session, setSession] = useState(initial);
  const [messages, setMessages] = useState(initialMessages);
  const [viewerCount, setViewerCount] = useState(initial.viewerCount);
  const [likeCount, setLikeCount] = useState(initial.likeCount);

  const [sheetProduct, setSheetProduct] = useState<ProductDetailDto | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [hearts, setHearts] = useState<Array<{ id: number; drift: number }>>([]);
  const [credentials, setCredentials] = useState<StreamCredentials | null>(null);
  // Autoplay only survives muted, so the player starts silent and the first
  // tap anywhere on the video turns the sound on. Nothing is lost meanwhile:
  // the product, the price and the chat are all readable without audio.
  const [soundOn, setSoundOn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saleToast, setSaleToast] = useState<string | null>(null);

  // Hearts are batched: a burst of taps becomes one request when it settles.
  const pendingHearts = useRef(0);
  const heartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartId = useRef(0);
  /** Set on mount, not during render: the render pass must stay pure. */
  const openedAt = useRef(0);
  /** Every pending animation timer, so none of them fires after unmount. */
  const heartTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = heartTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (heartTimer.current) clearTimeout(heartTimer.current);
    };
  }, []);

  const featured = session.products.find((product) => product.id === session.featuredProductId);
  const isLive = session.status === 'live' || session.status === 'interrupted';
  const isOver = session.status === 'ended' || session.status === 'cancelled';

  // --- Realtime ---------------------------------------------------------------
  //
  // Presence, chat, counters and the featured product all arrive over one
  // socket. Joining the room is what registers the viewer, so there is no
  // separate join call and no polling loop to keep in sync with it.

  const realtime = useLiveRealtime(initial.id, realtimeToken, {
    onViewerCount: setViewerCount,
    onMessage: (message) =>
      setMessages((current) =>
        current.some((entry) => entry.id === message.id)
          ? current
          : [...current.slice(-60), message],
      ),
    onReaction: (event) => setLikeCount(event.totalLikes),
    onSale: (event) => setSaleToast(event.productTitle),
    onState: (event) => {
      setSession((current) => ({
        ...current,
        ...(event.status ? { status: event.status as LiveDetailDto['status'] } : {}),
        featuredProductId: event.featuredProductId,
      }));
    },
  });

  useEffect(() => {
    openedAt.current = Date.now();
    track('live_view_started', { liveSessionId: initial.id, storeId: initial.store.id });

    const startedAt = openedAt.current;
    return () => {
      track('live_view_ended', {
        liveSessionId: initial.id,
        watchedSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
    };
  }, [initial.id, initial.store.id]);

  // --- Video ------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    // A session that is not watchable has no credentials to fetch, and the
    // API would answer null anyway. Asking is still the cheapest way to keep
    // one code path: the resolved value clears the previous one.
    const load = async () =>
      isLive ? ((await viewerCredentials(initial.id)) as StreamCredentials | null) : null;

    void load().then((result) => {
      if (!cancelled) setCredentials(result);
    });

    return () => {
      cancelled = true;
    };
  }, [initial.id, isLive]);

  const video = useViewerStream(credentials);

  // Telemetry about whether the video actually arrived. `provider` and a
  // reason, never a token and never a room id.
  const askedAt = useRef(0);
  useEffect(() => {
    if (!credentials) return;
    askedAt.current = Date.now();
    track('live_join_attempted', { liveSessionId: initial.id, role: 'viewer' });
  }, [credentials, initial.id]);

  useEffect(() => {
    if (!video.stream) return;
    track('live_video_connected', {
      liveSessionId: initial.id,
      provider: session.channel?.provider ?? 'mock',
      msToFirstFrame: askedAt.current > 0 ? Date.now() - askedAt.current : 0,
    });
  }, [video.stream, initial.id, session.channel?.provider]);

  useEffect(() => {
    if (!video.failed) return;
    track('live_video_failed', {
      liveSessionId: initial.id,
      provider: session.channel?.provider ?? 'mock',
      reason: 'connect_failed',
    });
  }, [video.failed, initial.id, session.channel?.provider]);

  /** Someone else bought. Anonymised on the server: a title, nothing more. */
  useEffect(() => {
    if (!saleToast) return;
    const timer = setTimeout(() => setSaleToast(null), 3500);
    return () => clearTimeout(timer);
  }, [saleToast]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const tapHeart = useCallback(() => {
    heartId.current += 1;
    const id = heartId.current;
    setHearts((current) => [...current.slice(-14), { id, drift: Math.round(Math.random() * 60 - 30) }]);
    setLikeCount((current) => current + 1);

    const timer = setTimeout(() => {
      heartTimers.current.delete(timer);
      setHearts((current) => current.filter((heart) => heart.id !== id));
    }, 1600);
    heartTimers.current.add(timer);

    pendingHearts.current += 1;
    if (heartTimer.current) clearTimeout(heartTimer.current);
    heartTimer.current = setTimeout(() => {
      const batch = pendingHearts.current;
      pendingHearts.current = 0;
      if (batch > 0) {
        realtime.sendReaction(batch);
        track('live_reaction_sent', { liveSessionId: initial.id, count: batch });
      }
    }, 900);
  }, [realtime, initial.id]);

  const openProduct = useCallback(
    async (productId: string) => {
      setProductsOpen(false);
      setSheetLoading(true);
      track('product_selected', {
        productId,
        variantId: '',
        liveSessionId: initial.id,
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/products/${productId}`,
      ).catch(() => null);

      if (response?.ok) setSheetProduct((await response.json()) as ProductDetailDto);
      setSheetLoading(false);
    },
    [initial.id],
  );

  const share = useCallback(async () => {
    const url = `${window.location.origin}/live/${initial.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: session.title, text: session.store.name, url });
        track('live_shared', { liveSessionId: initial.id, method: 'share_sheet' });
        return;
      }
      await navigator.clipboard.writeText(url);
      track('live_shared', { liveSessionId: initial.id, method: 'clipboard' });
      // Silence after a copy reads as a broken button, so say it happened.
      setCopied(true);
    } catch {
      // The user dismissed the share sheet; nothing to recover from.
    }
  }, [initial.id, session.title, session.store.name]);

  const stageImage = featured?.image?.url ?? session.thumbnailUrl;

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#0b0b0f] text-white">
      <VideoStage
        stream={video.stream}
        fallbackImageUrl={stageImage}
        muted={!soundOn}
        dimmed={!isLive}
        fallbackLabel={
          isOver
            ? 'Transmisión finalizada'
            : video.connecting
              ? 'Conectando con la tienda'
              : 'Video simulado'
        }
      />

      {/* Tapping the video is the sound control: a dedicated button would sit
          on top of the product bar, and every viewer's first instinct is to
          tap the picture anyway. */}
      {video.stream ? (
        <button
          type="button"
          onClick={() => setSoundOn((value) => !value)}
          aria-label={soundOn ? 'Silenciar' : 'Activar sonido'}
          className="absolute inset-0 z-0"
        />
      ) : null}

      {video.stream && !soundOn ? (
        <span className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-bold backdrop-blur-md">
          Tocá para activar el sonido
        </span>
      ) : null}

      {/* --- Top chrome ------------------------------------------------- */}
      <header className="relative z-10 flex items-start justify-between gap-2 px-3 pt-safe">
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Volver"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-black/40 backdrop-blur-md transition-colors hover:bg-black/60"
            >
              <ChevronLeftIcon className="size-5" />
            </button>

            {isLive ? (
              <Badge tone="live" className="h-7 uppercase">
                <LiveDot />
                En vivo
              </Badge>
            ) : (
              <Badge className="h-7 bg-black/55 text-white backdrop-blur-sm">Finalizado</Badge>
            )}

            <span
              className="inline-flex h-7 items-center gap-1 rounded-full bg-black/45 px-2.5 text-xs font-bold backdrop-blur-sm"
              aria-label={`${viewerCount} personas mirando`}
            >
              <EyeIcon className="size-3.5" />
              {viewers(viewerCount)}
            </span>
          </div>

          <div className="flex w-fit max-w-full items-center gap-2 rounded-full bg-black/40 py-1 pl-1 pr-1.5 backdrop-blur-md">
            <a
              href={`/tienda/${session.store.slug}`}
              className="flex min-w-0 items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Avatar src={session.store.logoUrl} name={session.store.name} size={30} />
              <span className="truncate text-[13px] font-bold">{session.store.name}</span>
            </a>
            <FollowButton
              storeId={session.store.id}
              storeName={session.store.name}
              following={session.store.isFollowing ?? false}
              size="sm"
              variant="dark"
              className="h-8 px-3 text-xs"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void share()}
          aria-label="Compartir transmisión"
          className="mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-black/40 backdrop-blur-md transition-colors hover:bg-black/60"
        >
          <ShareIcon className="size-5" />
        </button>
      </header>

      <h1 className="relative z-10 mt-2 line-clamp-2 px-3 text-[15px] font-semibold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
        {session.title}
      </h1>

      <div className="flex-1" />

      {/* --- Right rail --------------------------------------------------- */}
      <div className="pointer-events-none absolute bottom-56 right-3 z-20 flex flex-col items-center gap-4">
        <div className="pointer-events-auto relative flex flex-col items-center gap-1">
          {hearts.map((heart) => (
            <span
              key={heart.id}
              aria-hidden
              className="pointer-events-none absolute bottom-10 text-2xl animate-heart-float motion-reduce:hidden"
              style={{ ['--drift' as string]: `${heart.drift}px` }}
            >
              ❤️
            </span>
          ))}
          <button
            type="button"
            onClick={tapHeart}
            aria-label="Enviar un corazón"
            className="grid size-13 place-items-center rounded-full bg-black/40 backdrop-blur-md transition-transform active:scale-90 motion-reduce:active:scale-100"
          >
            <HeartIcon className="size-7 text-live" filled />
          </button>
          <span className="text-[11px] font-bold tabular-nums">{viewers(likeCount)}</span>
        </div>

        <div className="pointer-events-auto flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setProductsOpen(true)}
            aria-label={`Ver ${session.products.length} productos del vivo`}
            className="grid size-13 place-items-center rounded-full bg-black/40 backdrop-blur-md transition-transform active:scale-90 motion-reduce:active:scale-100"
          >
            <span className="text-lg font-extrabold">{session.products.length}</span>
          </button>
          <span className="text-[11px] font-bold">Productos</span>
        </div>
      </div>

      {/* --- Bottom stack --------------------------------------------------- */}
      <div className="relative z-10 flex flex-col gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {saleToast ? (
          <p
            role="status"
            className="w-fit animate-rise rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold backdrop-blur-md motion-reduce:animate-none"
          >
            Alguien acaba de comprar {saleToast}
          </p>
        ) : null}

        {copied ? (
          <p
            role="status"
            className="w-fit rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold backdrop-blur-md"
          >
            Link copiado
          </p>
        ) : null}

        <LiveChatOverlay messages={messages} />

        {featured ? (
          <button
            type="button"
            onClick={() => void openProduct(featured.id)}
            className="flex items-center gap-3 rounded-3xl bg-white/95 p-2.5 text-left text-ink shadow-raised backdrop-blur-md transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <span className="size-16 shrink-0 overflow-hidden rounded-2xl bg-muted">
              {featured.image ? (
                <img src={featured.image.url} alt="" className="size-full object-cover" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-bold leading-tight">{featured.title}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-lg font-extrabold">
                  {money(featured.priceMinor, featured.currency)}
                </span>
                {featured.compareAtPriceMinor ? (
                  <span className="text-xs text-subtle line-through">
                    {money(featured.compareAtPriceMinor, featured.currency)}
                  </span>
                ) : null}
              </span>
              {featured.stock > 0 && featured.stock <= 5 ? (
                <span className="text-[12px] font-bold text-live">Quedan {featured.stock}</span>
              ) : null}
            </span>
            <span className="shrink-0 rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-surface">
              Comprar
            </span>
          </button>
        ) : null}

        <LiveChatComposer
          liveSessionId={initial.id}
          signedIn={signedIn}
          send={realtime.sendChat}
          connected={realtime.state === 'connected'}
        />
      </div>

      {/* --- Sheets ------------------------------------------------------------ */}
      <Sheet
        open={sheetLoading || sheetProduct !== null}
        onClose={() => setSheetProduct(null)}
        title={sheetProduct?.title ?? 'Producto'}
        hideTitle
      >
        {sheetLoading || !sheetProduct ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-9 w-1/3" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        ) : (
          <ProductPanel
            product={sheetProduct}
            liveSessionId={initial.id}
            compact
            onNavigate={() => setSheetProduct(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={productsOpen}
        onClose={() => setProductsOpen(false)}
        title={`Productos del vivo (${session.products.length})`}
      >
        <ul className="flex flex-col divide-y divide-line">
          {session.products.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => void openProduct(product.id)}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {product.image ? (
                    <img src={product.image.url} alt="" className="size-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{product.title}</span>
                  <span className="block text-[15px] font-extrabold">
                    {money(product.priceMinor, product.currency)}
                  </span>
                </span>
                {product.id === session.featuredProductId ? (
                  <Badge tone="live">En pantalla</Badge>
                ) : product.stock <= 0 ? (
                  <Badge tone="neutral">Agotado</Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      {!isLive ? (
        <div className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center">
          <p className="text-lg font-extrabold">Esta transmisión terminó</p>
          <p className="mt-1 text-sm text-white/70">
            Podés seguir comprando los productos que mostró la tienda.
          </p>
          <Button
            variant="live"
            className="mt-4"
            onClick={() => router.push(`/tienda/${session.store.slug}`)}
          >
            Ver la tienda
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LiveViewerFallback() {
  return (
    <div className={cn('flex h-dvh flex-col justify-end gap-3 bg-[#0b0b0f] p-4')}>
      <Skeleton className="h-20 w-full rounded-3xl bg-white/10" />
      <Skeleton className="h-11 w-full rounded-full bg-white/10" />
    </div>
  );
}
