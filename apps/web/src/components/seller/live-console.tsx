'use client';

import { formatElapsed } from '@vivo/config';
import type {
  BidSessionDto,
  LiveDetailDto,
  LiveMessageDto,
  LiveStatsDto,
} from '@vivo/shared';
import { Badge, Button, LiveDot, Sheet, cn } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { VideoStage } from '@/components/live/video-stage';
import { CameraIcon, ChatIcon, EyeIcon, MicIcon, SwitchCameraIcon } from '@/components/icons';
import {
  CONNECTION_COPY,
  MEDIA_FAULT_COPY,
  useBroadcast,
  useWakeLock,
  type ConnectionLabel,
  type StreamCredentials,
} from '@/lib/live-media';
import { BidConsole } from './bid-console';
import { useLiveRealtime, type OrderCreatedEvent } from '@/lib/realtime';
import { useBidSessions } from '@/lib/use-bid-sessions';
import { broadcastCredentials, endLive, featureProduct, startLive } from '@/lib/actions/seller';
import { track } from '@/lib/analytics';
import { money, viewers } from '@/lib/format';
import { fetchSession } from '@/lib/live-client';

/**
 * Broadcast console.
 *
 * Designed for one hand while the other holds the phone at the product: every
 * control is at least 56 px, the destructive one ("Finalizar") needs a second
 * confirmation, and the product strip that changes what buyers see sits within
 * thumb reach at the bottom rather than in a menu.
 *
 * The camera is real from M02 on. What the seller sees in the preview is the
 * local `MediaStream`, mirrored only for the selfie lens, and it keeps working
 * even when publishing fails — a black rectangle would tell them nothing.
 */
export function LiveConsole({
  session: initial,
  initialStats,
  initialMessages,
  initialBids,
  realtimeToken,
}: {
  session: LiveDetailDto;
  initialStats: LiveStatsDto;
  initialMessages: LiveMessageDto[];
  initialBids: BidSessionDto[];
  realtimeToken: string | null;
}) {
  const router = useRouter();

  const [session, setSession] = useState(initial);
  const [stats, setStats] = useState(initialStats);
  const [messages, setMessages] = useState(initialMessages);
  const [elapsed, setElapsed] = useState(initialStats.elapsedSeconds);
  const [sale, setSale] = useState<string | null>(null);
  // Acá se decide dinero: además del socket, se reconcilia contra el servidor.
  const { sessions: bidSessions, refresh: refreshBids } = useBidSessions(initial.id, initialBids);

  const [credentials, setCredentials] = useState<StreamCredentials | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pending, startAction] = useTransition();

  const isLive = session.status === 'live' || session.status === 'interrupted';
  const onAir = isLive || session.status === 'starting';

  // The camera opens as soon as the console does, not when the broadcast
  // starts: a seller wants to check their framing before going live.
  const media = useBroadcast(credentials, true);
  useWakeLock(onAir);

  // --- Realtime -------------------------------------------------------------

  const onOrder = useCallback((event: OrderCreatedEvent) => {
    setStats((current) => ({
      ...current,
      ordersCount: event.ordersCount,
      unitsSold: event.unitsSold,
      revenueMinor: event.revenueMinor,
    }));
    setSale(event.productTitles[0] ?? 'Nueva venta');
  }, []);

  const realtime = useLiveRealtime(initial.id, realtimeToken, {
    onViewerCount: (viewerCount) => setStats((current) => ({ ...current, viewerCount })),
    onMessage: (message) => setMessages((current) => [...current.slice(-80), message]),
    onOrder,
    onBid: () => refreshBids(),
    onState: (event) => {
      if (!event.status) return;
      setSession((current) => ({
        ...current,
        status: event.status as LiveDetailDto['status'],
        featuredProductId: event.featuredProductId,
      }));
    },
  });

  // The sale toast clears itself, and the timer is cleaned up if another sale
  // lands first — the exact pattern M01 got wrong once already.
  useEffect(() => {
    if (!sale) return;
    const timer = setTimeout(() => setSale(null), 4000);
    return () => clearTimeout(timer);
  }, [sale]);

  // The clock ticks locally so the timer stays smooth between server updates.
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  // --- Credentials ----------------------------------------------------------

  useEffect(() => {
    if (!onAir) return;
    let cancelled = false;

    void broadcastCredentials(initial.id).then((result) => {
      if (!cancelled) setCredentials((result as StreamCredentials | null) ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [initial.id, onAir, session.status]);

  // --- Actions --------------------------------------------------------------

  const feature = (productId: string) => {
    startAction(async () => {
      await featureProduct(initial.id, productId);
      track('seller_highlight_changed', { liveSessionId: initial.id, productId });
      const next = await fetchSession(initial.id);
      if (next) setSession(next);
    });
  };

  const begin = () => {
    startAction(async () => {
      await startLive(initial.id);
      track('seller_live_started', {
        liveSessionId: initial.id,
        storeId: initial.store.id,
        productCount: initial.products.length,
      });
      router.refresh();
    });
  };

  const finish = () => {
    startAction(async () => {
      track('seller_live_ended', {
        liveSessionId: initial.id,
        elapsedSeconds: elapsed,
        unitsSold: stats.unitsSold,
      });
      await endLive(initial.id);
    });
  };

  // --- Telemetry --------------------------------------------------------------

  useEffect(() => {
    if (!media.fault) return;
    track('broadcast_permission_denied', { liveSessionId: initial.id, fault: media.fault });
  }, [media.fault, initial.id]);

  useEffect(() => {
    if (!media.publishing) return;
    track('broadcast_publish_started', {
      liveSessionId: initial.id,
      provider: session.channel?.provider ?? 'mock',
      facing: media.facing,
    });
  }, [media.publishing, media.facing, initial.id, session.channel?.provider]);

  useEffect(() => {
    if (media.quality === 'buena') return;
    track('broadcast_quality_degraded', { liveSessionId: initial.id, quality: media.quality });
  }, [media.quality, initial.id]);

  const featured = session.products.find((product) => product.id === session.featuredProductId);
  const quality: ConnectionLabel =
    realtime.state === 'offline'
      ? 'sin-conexion'
      : session.status === 'interrupted'
        ? 'inestable'
        : media.quality;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#0b0b0f] text-white">
      <VideoStage
        stream={media.cameraOn ? media.stream : null}
        fallbackImageUrl={featured?.image?.url ?? session.thumbnailUrl}
        muted
        mirrored={media.facing === 'user'}
        dimmed={!media.cameraOn}
        fallbackLabel={media.cameraOn ? 'Preparando cámara' : 'Cámara apagada'}
      />

      {/* --- Status bar -------------------------------------------------- */}
      <header className="relative z-10 flex items-center gap-2 px-3 pt-safe">
        <div className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 backdrop-blur-md">
          {isLive ? (
            <>
              <LiveDot className="text-live" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-live">
                En vivo
              </span>
              <span className="font-mono text-xs font-bold tabular-nums">
                {formatElapsed(elapsed)}
              </span>
            </>
          ) : (
            <span className="text-xs font-extrabold uppercase tracking-widest text-white/70">
              {session.status === 'scheduled'
                ? 'Programado'
                : session.status === 'starting'
                  ? 'Conectando'
                  : 'Finalizado'}
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-3 py-1.5 text-xs font-bold backdrop-blur-md">
          <EyeIcon className="size-3.5" />
          {viewers(stats.viewerCount)}
        </span>

        <QualityPill quality={quality} />
      </header>

      {/* --- Live counters ------------------------------------------------- */}
      <section className="relative z-10 mt-3 grid grid-cols-3 gap-2 px-3">
        <Counter label="Pedidos" value={String(stats.ordersCount)} />
        <Counter label="Unidades" value={String(stats.unitsSold)} />
        <Counter
          label="Facturado"
          value={money(stats.revenueMinor, stats.currency)}
          highlight={stats.revenueMinor > 0}
        />
      </section>

      {sale ? (
        <div
          role="status"
          className="relative z-20 mx-3 mt-2 animate-rise rounded-2xl bg-success/90 px-3 py-2 text-[13px] font-bold shadow-raised motion-reduce:animate-none"
        >
          Vendiste {sale}
        </div>
      ) : null}

      {session.status === 'interrupted' ? (
        <div
          role="status"
          className="relative z-20 mx-3 mt-2 rounded-2xl bg-black/70 px-3 py-2 text-[13px] font-semibold backdrop-blur-md"
        >
          Se cortó la conexión. Estamos reconectando — tu vivo sigue abierto.
        </div>
      ) : null}

      <div className="flex-1" />

      {media.fault ? <MediaFaultCard fault={media.fault} onRetry={media.retry} /> : null}

      {/* --- Device controls ------------------------------------------------- */}
      <div className="relative z-10 flex items-center justify-center gap-3 pb-3">
        <DeviceButton
          active={media.micOn}
          onClick={media.toggleMic}
          label={media.micOn ? 'Silenciar micrófono' : 'Activar micrófono'}
        >
          <MicIcon className="size-6" />
        </DeviceButton>
        <DeviceButton
          active={media.cameraOn}
          onClick={media.toggleCamera}
          label={media.cameraOn ? 'Apagar cámara' : 'Encender cámara'}
        >
          <CameraIcon className="size-6" />
        </DeviceButton>
        <DeviceButton
          active
          onClick={media.switchCamera}
          label={media.facing === 'user' ? 'Usar cámara trasera' : 'Usar cámara frontal'}
        >
          <SwitchCameraIcon className="size-6" />
        </DeviceButton>
        <DeviceButton active onClick={() => setChatOpen(true)} label="Ver comentarios">
          <ChatIcon className="size-6" />
          {messages.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-live px-1 text-[10px] font-bold">
              {messages.length}
            </span>
          ) : null}
        </DeviceButton>
      </div>

      {/* --- Modo Puja: lo que hay que decidir ahora --------------------------- */}
      <section className="relative z-10 px-3 pb-2">
        <BidConsole
          liveSessionId={initial.id}
          products={session.products}
          sessions={bidSessions}
          onChanged={refreshBids}
        />
      </section>

      {/* --- Product strip: what the buyer sees ------------------------------- */}
      <section className="relative z-10 flex flex-col gap-2 px-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">
          Tocá para destacar
        </p>
        <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {session.products.map((product) => {
            const active = product.id === session.featuredProductId;
            return (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => feature(product.id)}
                  disabled={pending}
                  aria-pressed={active}
                  className={cn(
                    'relative flex w-[132px] shrink-0 flex-col gap-1 rounded-2xl p-2 text-left transition-colors',
                    active ? 'bg-white text-ink' : 'bg-black/45 text-white backdrop-blur-md',
                  )}
                >
                  <span className="aspect-square w-full overflow-hidden rounded-xl bg-black/20">
                    {product.image ? (
                      <img src={product.image.url} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="line-clamp-1 text-[12px] font-bold">{product.title}</span>
                  <span className="text-[13px] font-extrabold">
                    {money(product.priceMinor, product.currency)}
                  </span>
                  {active ? (
                    <span className="absolute right-2 top-2">
                      <Badge tone="live" className="px-1.5 py-0.5 text-[9px]">
                        En pantalla
                      </Badge>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* --- Primary action ------------------------------------------------------ */}
      <div className="relative z-10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {session.status === 'scheduled' ? (
          <Button variant="live" block size="lg" loading={pending} onClick={begin}>
            Comenzar a transmitir
          </Button>
        ) : isLive || session.status === 'starting' ? (
          confirmEnd ? (
            <div className="flex flex-col gap-2 rounded-3xl bg-black/70 p-4 backdrop-blur-md">
              <p className="text-[15px] font-bold">¿Finalizar la transmisión?</p>
              <p className="text-[13px] text-white/70">
                Los compradores dejan de verte y el vivo pasa a finalizado.
              </p>
              <div className="flex gap-2 pt-1">
                <Button variant="danger" size="md" loading={pending} onClick={finish}>
                  Sí, finalizar
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  className="text-white hover:bg-white/10"
                  onClick={() => setConfirmEnd(false)}
                >
                  Seguir en vivo
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="danger"
              block
              size="lg"
              onClick={() => setConfirmEnd(true)}
              className="bg-white/12 text-white hover:bg-white/20"
            >
              Finalizar transmisión
            </Button>
          )
        ) : (
          <Button variant="secondary" block size="lg" onClick={() => router.push('/vender')}>
            Volver al panel
          </Button>
        )}
      </div>

      <Sheet open={chatOpen} onClose={() => setChatOpen(false)} title="Comentarios">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-subtle">Todavía no hay comentarios.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col">
                <span className="text-[13px] font-bold text-ink">{message.authorName}</span>
                <span className="text-[15px] leading-snug text-ink-soft">{message.body}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

/**
 * Connection quality in words.
 *
 * A seller mid-broadcast cannot act on "RTT 147 ms, pérdida 3.77%". They can
 * act on "conexión inestable": move nearer the router, or stop walking.
 */
function QualityPill({ quality }: { quality: ConnectionLabel }) {
  const tone =
    quality === 'buena'
      ? 'bg-success'
      : quality === 'regular'
        ? 'bg-warning'
        : quality === 'inestable'
          ? 'bg-live'
          : 'bg-white/40';

  return (
    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-bold backdrop-blur-md">
      <span className={cn('size-2 rounded-full', tone)} />
      {CONNECTION_COPY[quality]}
    </span>
  );
}

function MediaFaultCard({ fault, onRetry }: { fault: keyof typeof MEDIA_FAULT_COPY; onRetry: () => void }) {
  const copy = MEDIA_FAULT_COPY[fault];
  return (
    <div
      role="alert"
      className="relative z-20 mx-3 mb-3 flex flex-col gap-2 rounded-3xl bg-black/75 p-4 backdrop-blur-md"
    >
      <p className="text-[15px] font-bold">{copy.title}</p>
      <p className="text-[13px] text-white/75">{copy.hint}</p>
      <Button variant="secondary" size="md" className="mt-1 self-start" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

function Counter({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-3 py-2 text-center backdrop-blur-md',
        highlight ? 'bg-success/25' : 'bg-black/40',
      )}
    >
      <p className="text-[17px] font-extrabold leading-tight tabular-nums">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/65">{label}</p>
    </div>
  );
}

function DeviceButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'relative grid size-14 place-items-center rounded-full backdrop-blur-md transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        'active:scale-95 motion-reduce:active:scale-100',
        active ? 'bg-white/18 text-white hover:bg-white/25' : 'bg-live text-white',
      )}
    >
      {children}
    </button>
  );
}
