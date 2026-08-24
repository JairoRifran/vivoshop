'use client';

import { installmentPreview, stockUrgency } from '@vivo/domain';
import type { ProductDetailDto, ProductVariantDto } from '@vivo/shared';
import { Badge, Button, cn } from '@vivo/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';
import { money } from '@/lib/format';
import { TruckIcon } from './icons';

/**
 * Product selection: images, options, stock and the buy CTA.
 *
 * The same component backs the full product page and the bottom sheet inside
 * the live viewer, because a buyer choosing a size mid-broadcast and one
 * browsing a store are doing the identical job. Duplicating it would guarantee
 * the two drift.
 */
export function ProductPanel({
  product,
  liveSessionId,
  compact = false,
  onNavigate,
}: {
  product: ProductDetailDto;
  liveSessionId?: string;
  /** Sheet mode: tighter spacing, no image gallery. */
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  const available = useMemo(
    () => product.variants.filter((variant) => variant.active),
    [product.variants],
  );
  const firstInStock = available.find((variant) => variant.stock > 0) ?? available[0];

  const [variantId, setVariantId] = useState<string | undefined>(firstInStock?.id);
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);

  const variant = available.find((candidate) => candidate.id === variantId) ?? firstInStock;
  const hasOptions = product.options.length > 0 && available.some((v) => v.label.length > 0);

  useEffect(() => {
    track('product_viewed', {
      productId: product.id,
      storeId: product.storeId,
      ...(liveSessionId ? { liveSessionId } : {}),
    });
  }, [product.id, product.storeId, liveSessionId]);

  if (!variant) {
    return <p className="py-6 text-center text-[15px] text-subtle">Producto sin variantes activas.</p>;
  }

  // Derived, not synchronised: switching to a variant with less stock clamps
  // the quantity on the very same render, with no extra pass and no window in
  // which the UI shows a quantity that cannot be bought.
  const quantity = Math.min(Math.max(1, requestedQuantity), Math.max(1, variant.stock));

  const priceMinor = variant.priceMinor;
  const urgency = stockUrgency(variant.stock);
  const soldOut = variant.stock <= 0;
  const installments = installmentPreview(priceMinor * quantity, 6);

  const buy = () => {
    track('checkout_started', {
      productId: product.id,
      variantId: variant.id,
      totalMinor: priceMinor * quantity,
      currency: product.currency,
    });
    onNavigate?.();

    const params = new URLSearchParams({
      producto: product.id,
      variante: variant.id,
      cantidad: String(quantity),
    });
    if (liveSessionId) params.set('vivo', liveSessionId);
    router.push(`/checkout?${params.toString()}`);
  };

  return (
    <div className={cn('flex flex-col', compact ? 'gap-4' : 'gap-5')}>
      {!compact && product.images.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="relative aspect-4/5 overflow-hidden rounded-3xl bg-muted">
            <img
              src={product.images[imageIndex]?.url ?? product.images[0]?.url}
              alt={product.images[imageIndex]?.alt ?? product.title}
              className="size-full object-cover"
            />
            {product.discountPercent ? (
              <span className="absolute left-3 top-3">
                <Badge tone="live">-{product.discountPercent}%</Badge>
              </span>
            ) : null}
          </div>
          {product.images.length > 1 ? (
            <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="Fotos">
              {product.images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  role="tab"
                  aria-selected={index === imageIndex}
                  aria-label={`Foto ${index + 1}`}
                  onClick={() => setImageIndex(index)}
                  className={cn(
                    'size-16 shrink-0 overflow-hidden rounded-xl border-2 transition-colors',
                    index === imageIndex ? 'border-ink' : 'border-transparent opacity-70',
                  )}
                >
                  <img src={image.url} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h1 className={cn('font-extrabold tracking-tight', compact ? 'text-xl' : 'text-2xl')}>
          {product.title}
        </h1>
        <p className="text-[13px] text-subtle">{product.storeName}</p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[28px] font-extrabold leading-none tracking-tight">
          {money(priceMinor, product.currency)}
        </span>
        {product.compareAtPriceMinor && product.compareAtPriceMinor > priceMinor ? (
          <span className="text-[15px] text-subtle line-through">
            {money(product.compareAtPriceMinor, product.currency)}
          </span>
        ) : null}
      </div>

      {installments ? (
        <p className="-mt-2 text-[13px] text-subtle">
          o {installments.installments} cuotas de{' '}
          <strong className="font-bold text-ink-soft">
            {money(installments.amountMinor, product.currency)}
          </strong>
          <span className="text-subtle"> · referencial</span>
        </p>
      ) : null}

      {hasOptions ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-bold">
            {product.options.map((option) => option.name).join(' y ')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {available.map((option) => (
              <VariantChip
                key={option.id}
                variant={option}
                selected={option.id === variant.id}
                onSelect={() => setVariantId(option.id)}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <QuantityStepper
          value={quantity}
          max={Math.max(1, variant.stock)}
          onChange={setRequestedQuantity}
          disabled={soldOut}
        />
        <StockNote urgency={urgency} stock={variant.stock} />
      </div>

      {product.description && !compact ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-4">
          <h2 className="text-sm font-bold">Descripción</h2>
          <p className="text-pretty text-[15px] leading-relaxed text-ink-soft">
            {product.description}
          </p>
        </div>
      ) : null}

      {compact && product.description ? (
        <p className="line-clamp-2 text-[14px] leading-relaxed text-subtle">{product.description}</p>
      ) : null}

      <div className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-3 text-[13px] text-ink-soft">
        <TruckIcon className="size-4 shrink-0 text-subtle" />
        <span>Envío a todo el país, retiro o coordinación con la tienda.</span>
      </div>

      <Button onClick={buy} disabled={soldOut} block size="lg">
        {soldOut ? 'Sin stock' : 'Comprar ahora'}
      </Button>
    </div>
  );
}

function VariantChip({
  variant,
  selected,
  onSelect,
}: {
  variant: ProductVariantDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const soldOut = variant.stock <= 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      disabled={soldOut}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-2xl border px-4 text-sm font-bold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        selected ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink hover:bg-muted',
        soldOut && 'cursor-not-allowed text-subtle line-through opacity-50',
      )}
    >
      {variant.label || 'Único'}
    </button>
  );
}

function QuantityStepper({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-2xl border border-line bg-surface">
      <button
        type="button"
        aria-label="Quitar una unidad"
        disabled={disabled || value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="grid size-11 place-items-center rounded-l-2xl text-lg font-bold text-ink disabled:text-subtle"
      >
        −
      </button>
      <span aria-live="polite" className="min-w-10 text-center text-[15px] font-bold">
        {value}
      </span>
      <button
        type="button"
        aria-label="Agregar una unidad"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid size-11 place-items-center rounded-r-2xl text-lg font-bold text-ink disabled:text-subtle"
      >
        +
      </button>
    </div>
  );
}

/**
 * Scarcity is shown only when it is real and small. "Quedan 3" is information;
 * a permanent urgency banner is a dark pattern.
 */
function StockNote({ urgency, stock }: { urgency: ReturnType<typeof stockUrgency>; stock: number }) {
  if (urgency === 'out') return <Badge tone="danger">Sin stock</Badge>;
  if (urgency === 'last') return <Badge tone="warning">Queda 1</Badge>;
  if (urgency === 'low') return <Badge tone="warning">Quedan {stock}</Badge>;
  return <span className="text-[13px] text-subtle">Stock disponible</span>;
}
