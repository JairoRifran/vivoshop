'use client';

import type { ProductSummaryDto } from '@vivo/shared';
import { Button, TextInput, cn } from '@vivo/ui';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { CalendarIcon, CheckIcon } from '@/components/icons';
import { createLive } from '@/lib/actions/seller';
import { IDLE } from '@/lib/actions/state';
import { money } from '@/lib/format';

/**
 * Create or schedule a broadcast.
 *
 * The product picker is the substance of this form: a live with no products
 * attached cannot sell anything, so the submit stays disabled until at least
 * one is chosen, and the count is always visible above the fold.
 */
export function CreateLiveForm({
  products,
  defaultMode,
}: {
  products: ProductSummaryDto[];
  defaultMode: 'now' | 'scheduled';
}) {
  const [state, action, pending] = useActionState(createLive, IDLE);
  const [mode, setMode] = useState<'now' | 'scheduled'>(defaultMode);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const sellable = products.filter((product) => product.status === 'active');

  return (
    <form action={action} className="flex flex-col gap-6 pb-32">
      <input type="hidden" name="mode" value={mode} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="productIds" value={id} />
      ))}

      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      <TextInput
        label="Título del vivo"
        name="title"
        required
        maxLength={90}
        placeholder="Nueva colección otoño"
        hint="Lo que ve el comprador en el feed."
        error={state.fieldErrors?.title?.[0]}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-[15px] font-extrabold">¿Cuándo?</legend>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            selected={mode === 'now'}
            onSelect={() => setMode('now')}
            title="Ahora"
            description="Empezás a transmitir al crear"
          />
          <ModeCard
            selected={mode === 'scheduled'}
            onSelect={() => setMode('scheduled')}
            title="Programar"
            description="Avisamos a tus seguidores"
            icon={<CalendarIcon className="size-4" />}
          />
        </div>
      </fieldset>

      {mode === 'scheduled' ? (
        <TextInput
          label="Fecha y hora"
          name="scheduledAt"
          type="datetime-local"
          required
          hint="Hora de Uruguay."
          error={state.fieldErrors?.scheduledAt?.[0]}
        />
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="flex w-full items-baseline justify-between pb-2">
          <span className="text-[15px] font-extrabold">Productos del vivo</span>
          <span
            className={cn(
              'text-[13px] font-bold',
              selected.length === 0 ? 'text-danger' : 'text-subtle',
            )}
          >
            {selected.length} elegidos
          </span>
        </legend>

        {sellable.length === 0 ? (
          <p className="rounded-2xl bg-muted px-4 py-5 text-center text-[14px] text-subtle">
            No tenés productos publicados.{' '}
            <Link href="/vender/productos/nuevo" className="font-bold text-ink underline">
              Cargá el primero
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sellable.map((product) => {
              const active = selected.includes(product.id);
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => toggle(product.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border bg-surface p-3 text-left transition-colors',
                      active ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-muted',
                    )}
                  >
                    <span className="size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                      {product.image ? (
                        <img src={product.image.url} alt="" className="size-full object-cover" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{product.title}</span>
                      <span className="block text-[13px] text-subtle">
                        {money(product.priceMinor, product.currency)} · {product.stock} en stock
                      </span>
                    </span>
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-full border-2',
                        active ? 'border-brand bg-brand text-white' : 'border-line',
                      )}
                    >
                      {active ? <CheckIcon className="size-3.5" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-lg">
        <div className="mx-auto max-w-2xl px-4 pb-safe pt-3">
          <Button
            type="submit"
            block
            size="lg"
            variant={mode === 'now' ? 'live' : 'primary'}
            loading={pending}
            disabled={selected.length === 0}
          >
            {mode === 'now' ? 'Iniciar transmisión' : 'Programar transmisión'}
          </Button>
          {selected.length === 0 ? (
            <p className="pt-2 text-center text-[12px] text-subtle">Elegí al menos un producto.</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function ModeCard({
  selected,
  onSelect,
  title,
  description,
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-1 rounded-2xl border bg-surface p-4 text-left transition-colors',
        selected ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-1.5 text-[15px] font-extrabold">
        {icon}
        {title}
      </span>
      <span className="text-[12px] leading-snug text-subtle">{description}</span>
    </button>
  );
}
