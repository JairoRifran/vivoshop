'use client';

import { parseMoneyInput } from '@vivo/config';
import type { ProductDetailDto } from '@vivo/shared';
import { Button, SelectField, TextArea, TextInput, cn } from '@vivo/ui';
import { useActionState, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import { createProduct, updateProduct } from '@/lib/actions/seller';
import { IDLE } from '@/lib/actions/state';
import { money } from '@/lib/format';

interface VariantRow {
  key: string;
  label: string;
  stock: string;
  price: string;
}

/**
 * Product editor.
 *
 * Variants are the only genuinely fiddly part of a catalogue form on a phone,
 * so they are modelled as a single named dimension with a row per value
 * ("Talle: S / M / L"). That covers the overwhelming majority of what these
 * sellers list, and the domain already supports richer combinations for when
 * the UI grows to allow them.
 */
export function ProductForm({ product }: { product?: ProductDetailDto }) {
  const editing = Boolean(product);
  const boundUpdate = updateProduct.bind(null, product?.id ?? '');
  const [state, action, pending] = useActionState(editing ? boundUpdate : createProduct, IDLE);

  const [price, setPrice] = useState(
    product ? String((product.priceMinor / 100).toFixed(2)).replace('.', ',') : '',
  );

  const initialRows: VariantRow[] = product
    ? product.variants
        .filter((variant) => variant.label.length > 0)
        .map((variant, index) => ({
          key: `${variant.id}-${index}`,
          label: variant.label,
          stock: String(variant.stock),
          price: '',
        }))
    : [];

  const [rows, setRows] = useState<VariantRow[]>(initialRows);
  const [simpleStock, setSimpleStock] = useState(
    product && initialRows.length === 0 ? String(product.stock) : '10',
  );

  const parsed = parseMoneyInput(price, 'UYU');

  const addRow = () =>
    setRows((current) => [
      ...current,
      { key: `row-${current.length}-${current.length + 1}`, label: '', stock: '5', price: '' },
    ]);

  const updateRow = (key: string, patch: Partial<VariantRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  return (
    <form action={action} className="flex flex-col gap-5 pb-32">
      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      <TextInput
        label="Título"
        name="title"
        required
        maxLength={120}
        defaultValue={product?.title ?? ''}
        placeholder="Campera Roma"
        error={state.fieldErrors?.title?.[0]}
      />

      <TextArea
        label="Descripción"
        name="description"
        rows={4}
        maxLength={2000}
        defaultValue={product?.description ?? ''}
        placeholder="Material, calce, medidas, cuidados."
      />

      <div className="grid grid-cols-2 gap-3">
        <TextInput
          label="Precio"
          name="price"
          inputMode="decimal"
          required
          prefix="$"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          hint={parsed ? money(parsed) : 'En pesos uruguayos'}
          error={state.fieldErrors?.basePriceMinor?.[0]}
        />
        <TextInput
          label="Precio anterior"
          name="compareAtPrice"
          inputMode="decimal"
          prefix="$"
          defaultValue={
            product?.compareAtPriceMinor
              ? String((product.compareAtPriceMinor / 100).toFixed(2)).replace('.', ',')
              : ''
          }
          hint="Opcional. Muestra el descuento."
        />
      </div>

      {/* --- Variants ------------------------------------------------------- */}
      <fieldset className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4">
        <legend className="px-1 text-[15px] font-extrabold">Variantes</legend>

        {rows.length === 0 ? (
          <>
            <p className="text-[13px] leading-relaxed text-subtle">
              Este producto se vende sin variantes. Si tenés talles o colores, agregalos abajo.
            </p>
            <TextInput
              label="Stock"
              name="stock"
              inputMode="numeric"
              value={simpleStock}
              onChange={(event) => setSimpleStock(event.target.value)}
            />
          </>
        ) : (
          <>
            <TextInput
              label="Nombre de la variante"
              name="optionName"
              defaultValue={product?.options[0]?.name ?? 'Talle'}
              placeholder="Talle, Color, Sabor…"
            />
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.key} className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[12px] font-bold text-subtle">Valor</label>
                    <input
                      name="variantLabel"
                      value={row.label}
                      onChange={(event) => updateRow(row.key, { label: event.target.value })}
                      placeholder="M"
                      className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px] focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
                    />
                  </div>
                  <div className="w-20">
                    <label className="mb-1 block text-[12px] font-bold text-subtle">Stock</label>
                    <input
                      name="variantStock"
                      inputMode="numeric"
                      value={row.stock}
                      onChange={(event) => updateRow(row.key, { stock: event.target.value })}
                      className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px] focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
                    />
                  </div>
                  <input type="hidden" name="variantPrice" value={row.price} />
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label={`Quitar variante ${row.label || 'sin nombre'}`}
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-subtle transition-colors hover:bg-muted hover:text-danger"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          onClick={addRow}
          className={cn(
            'inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line',
            'text-[14px] font-bold text-ink-soft transition-colors hover:bg-muted',
          )}
        >
          <PlusIcon className="size-4" />
          Agregar variante
        </button>
      </fieldset>

      <SelectField
        label="Estado"
        name="status"
        defaultValue={product?.status === 'paused' ? 'paused' : 'active'}
        options={[
          { value: 'active', label: 'Publicado' },
          { value: 'paused', label: 'Pausado' },
        ]}
        hint="Los pausados no se ven en la tienda ni se pueden comprar."
      />

      <p className="rounded-2xl bg-muted px-4 py-3 text-[13px] leading-relaxed text-subtle">
        Las fotos se generan automáticamente en esta versión. La carga de imágenes llega junto con
        el almacenamiento en M02.
      </p>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-lg">
        <div className="mx-auto max-w-2xl px-4 pb-safe pt-3">
          <Button type="submit" block loading={pending}>
            {editing ? 'Guardar cambios' : 'Publicar producto'}
          </Button>
        </div>
      </div>
    </form>
  );
}
