'use client';

import type { StoreDetailDto } from '@vivo/shared';
import { Button, SelectField, TextArea, TextInput } from '@vivo/ui';
import { useActionState } from 'react';
import { ImageField } from '@/components/image-field';
import { updateStoreSettings } from '@/lib/actions/seller';
import { IDLE } from '@/lib/actions/state';

export function StoreSettingsForm({ store }: { store: StoreDetailDto }) {
  const [state, action, pending] = useActionState(updateStoreSettings, IDLE);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-card">
      <h2 className="text-[17px] font-extrabold tracking-tight">Datos de la tienda</h2>

      {state.status === 'success' && state.message ? (
        <p role="status" className="rounded-2xl bg-success/10 px-4 py-3 text-sm font-semibold text-success-ink">
          {state.message}
        </p>
      ) : null}
      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      {/* La identidad primero: es lo que ve quien entra a la tienda, y lo que
          más distingue una tienda de otra en una grilla. */}
      <ImageField
        name="logoKey"
        purpose="store_logo"
        label="Logo"
        shape="square"
        currentUrl={store.logoUrl}
        hint="Cuadrado. Aparece en la grilla, en el vivo y en cada producto."
      />
      <ImageField
        name="coverKey"
        purpose="store_cover"
        label="Portada"
        shape="wide"
        currentUrl={store.coverUrl}
        hint="Apaisada. Es el encabezado de tu tienda."
      />

      <TextInput label="Nombre" name="name" defaultValue={store.name} required maxLength={60} />
      <TextArea
        label="Descripción"
        name="description"
        rows={3}
        maxLength={400}
        defaultValue={store.description}
      />
      <TextInput label="Ciudad" name="city" defaultValue={store.city ?? ''} />
      <TextInput
        label="WhatsApp"
        name="whatsapp"
        type="tel"
        inputMode="tel"
        defaultValue={store.whatsapp ?? ''}
        hint="Opcional. Se muestra en tu tienda para coordinar entregas."
      />
      <TextInput
        label="Envío gratis desde"
        name="freeShippingThreshold"
        inputMode="decimal"
        prefix="$"
        defaultValue={
          store.freeShippingThresholdMinor
            ? String((store.freeShippingThresholdMinor / 100).toFixed(2)).replace('.', ',')
            : ''
        }
        hint="Dejalo vacío para cobrar siempre el envío."
      />
      <TextArea
        label="Instrucciones de retiro"
        name="pickupInstructions"
        rows={2}
        maxLength={240}
        defaultValue={store.pickupInstructions ?? ''}
        placeholder="Dirección y horarios para retirar."
      />
      <SelectField
        label="Estado de la tienda"
        name="status"
        defaultValue={store.status === 'paused' ? 'paused' : 'active'}
        options={[
          { value: 'active', label: 'Abierta' },
          { value: 'paused', label: 'Pausada' },
        ]}
        hint="Pausada: la tienda se ve pero no recibe pedidos."
      />

      <Button type="submit" block loading={pending}>
        Guardar cambios
      </Button>
    </form>
  );
}
