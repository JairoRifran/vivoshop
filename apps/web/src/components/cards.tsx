import type { LiveSummaryDto, ProductSummaryDto, StoreSummaryDto } from '@vivo/shared';
import { Avatar, Badge, LiveDot, cn } from '@vivo/ui';
import Link from 'next/link';
import { money, scheduleLabel, viewers } from '@/lib/format';
import { STORE_CATEGORY_LABEL } from '@/lib/format';
import { EyeIcon } from './icons';
import { VerifiedMark } from './verified-badge';

/**
 * Shared media frame.
 *
 * `loading="lazy"` plus explicit dimensions means no layout shift and no
 * bandwidth spent on cards below the fold — the difference is visible on a
 * mid-range Android over 4G, which is the target device.
 */
function Media({
  src,
  alt,
  className,
  priority = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  if (!src) return <div className={cn('bg-muted-strong', className)} aria-hidden />;
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={cn('size-full object-cover', className)}
    />
  );
}

/** The hero card on the home rail: vertical, video-shaped, thumb-sized. */
export function LiveCard({
  session,
  priority = false,
  className,
}: {
  session: LiveSummaryDto;
  priority?: boolean;
  className?: string;
}) {
  const isLive = session.status === 'live';

  return (
    <Link
      href={`/live/${session.id}`}
      className={cn(
        'group relative block aspect-9/16 w-[168px] shrink-0 overflow-hidden rounded-3xl bg-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'transition-transform duration-200 active:scale-[0.98] motion-reduce:active:scale-100',
        className,
      )}
    >
      <Media src={session.thumbnailUrl} alt="" priority={priority} className="opacity-95" />

      {/* Two stops rather than a full-height scrim: the middle of the frame
          stays clear so the imagery is still readable. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-b from-black/45 via-transparent to-black/80"
      />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2.5">
        {isLive ? (
          <Badge tone="live" className="uppercase">
            <LiveDot />
            En vivo
          </Badge>
        ) : (
          <Badge className="bg-black/55 text-white backdrop-blur-sm">
            {scheduleLabel(session.scheduledAt)}
          </Badge>
        )}
        {isLive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
            <EyeIcon className="size-3.5" />
            {viewers(session.viewerCount)}
          </span>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3">
        <div className="flex items-center gap-2">
          <Avatar src={session.store.logoUrl} name={session.store.name} size={24} />
          <span className="truncate text-xs font-bold text-white/95">{session.store.name}</span>
          {session.store.isVerified ? <VerifiedMark className="size-3.5 text-white" /> : null}
        </div>
        <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-white">
          {session.title}
        </p>
        {session.featuredProduct ? (
          <span className="w-fit rounded-lg bg-white/95 px-2 py-1 text-[11px] font-extrabold text-ink">
            {money(session.featuredProduct.priceMinor, session.featuredProduct.currency)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/** Wide variant for the "En vivo" tab, where the list is the whole screen. */
export function LiveRowCard({ session }: { session: LiveSummaryDto }) {
  const isLive = session.status === 'live';

  return (
    <Link
      href={`/live/${session.id}`}
      className="group flex gap-3 rounded-3xl bg-surface p-3 shadow-card transition-transform active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:active:scale-100"
    >
      <div className="relative aspect-3/4 w-24 shrink-0 overflow-hidden rounded-2xl bg-ink">
        <Media src={session.thumbnailUrl} alt="" />
        {isLive ? (
          <span className="absolute left-1.5 top-1.5">
            <Badge tone="live" className="px-1.5 py-0.5 text-[10px] uppercase">
              <LiveDot />
              Vivo
            </Badge>
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <Avatar src={session.store.logoUrl} name={session.store.name} size={22} />
          <span className="truncate text-[13px] font-bold">{session.store.name}</span>
          {session.store.isVerified ? <VerifiedMark className="size-3.5" /> : null}
          {session.store.city ? (
            <span className="truncate text-xs text-subtle">· {session.store.city}</span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{session.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
          {isLive ? (
            <span className="inline-flex items-center gap-1 font-semibold text-live">
              <EyeIcon className="size-3.5" />
              {viewers(session.viewerCount)} mirando
            </span>
          ) : (
            <span className="font-semibold text-ink-soft">
              {scheduleLabel(session.scheduledAt)}
            </span>
          )}
          <span>
            {session.productCount} {session.productCount === 1 ? 'producto' : 'productos'}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ProductCard({
  product,
  href,
  className,
}: {
  product: ProductSummaryDto;
  href?: string;
  className?: string;
}) {
  const soldOut = product.stock <= 0;

  return (
    <Link
      href={href ?? `/producto/${product.id}`}
      className={cn(
        'group flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      <div className="relative aspect-4/5 overflow-hidden rounded-2xl bg-muted">
        <Media
          src={product.image?.url ?? null}
          alt={product.image?.alt ?? product.title}
          className="transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {product.discountPercent ? (
          <span className="absolute left-2 top-2">
            <Badge tone="live">-{product.discountPercent}%</Badge>
          </span>
        ) : null}
        {soldOut ? (
          <span className="absolute inset-0 grid place-items-center bg-surface/75 text-sm font-bold text-ink">
            Agotado
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{product.title}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-extrabold">
            {money(product.priceMinor, product.currency)}
          </span>
          {product.compareAtPriceMinor ? (
            <span className="text-xs text-subtle line-through">
              {money(product.compareAtPriceMinor, product.currency)}
            </span>
          ) : null}
        </div>
        <span className="truncate text-xs text-subtle">{product.storeName}</span>
      </div>
    </Link>
  );
}

export function StoreRow({ store }: { store: StoreSummaryDto }) {
  return (
    <Link
      href={`/tienda/${store.slug}`}
      className="flex items-center gap-3 rounded-2xl px-1 py-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <div className="relative">
        <Avatar src={store.logoUrl} name={store.name} size={48} />
        {store.isLiveNow ? (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-live px-1.5 text-[9px] font-extrabold uppercase leading-4 text-white ring-2 ring-surface">
            vivo
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-[15px] font-bold">
          <span className="truncate">{store.name}</span>
          {/* Solo el si. No hay marca para "sin verificar": una tienda de un
              vendedor particular se ve igual que siempre. */}
          {store.isVerified ? <VerifiedMark /> : null}
        </p>
        <p className="truncate text-xs text-subtle">
          {STORE_CATEGORY_LABEL[store.category] ?? store.category}
          {store.city ? ` · ${store.city}` : ''}
          {/* Sin reseñas no se muestra "★ 0.0", que se lee como la peor nota
              posible en vez de como la ausencia de notas. Ver `docs/m09.md`. */}
          {store.reviewCount > 0 ? ` · ★ ${store.rating.toFixed(1)}` : ' · Nueva'}
        </p>
      </div>
      {store.isFollowing ? (
        <Badge tone="neutral" className="shrink-0">
          Siguiendo
        </Badge>
      ) : null}
    </Link>
  );
}

/** Circular story-style entry used for the "tiendas que sigo" rail. */
export function StoreBubble({ store }: { store: StoreSummaryDto }) {
  return (
    <Link
      href={`/tienda/${store.slug}`}
      className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span
        className={cn(
          'grid size-16 place-items-center rounded-full p-0.5',
          store.isLiveNow ? 'bg-linear-to-tr from-live to-orange-400' : 'bg-muted-strong',
        )}
      >
        <span className="grid size-full place-items-center rounded-full bg-surface p-0.5">
          <Avatar src={store.logoUrl} name={store.name} size={56} className="size-full" />
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] font-semibold text-ink-soft">
        {store.name}
      </span>
    </Link>
  );
}
