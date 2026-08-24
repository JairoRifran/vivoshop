'use client';

import { STORE_CATEGORIES } from '@vivo/domain';
import { Button, SelectField, TextArea, TextInput } from '@vivo/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { ChevronLeftIcon } from '@/components/icons';
import { becomeSeller } from '@/lib/actions/seller';
import { IDLE } from '@/lib/actions/state';
import { STORE_CATEGORY_LABEL } from '@/lib/format';

/**
 * Seller onboarding.
 *
 * Four fields, because every extra one here is a seller who never starts. The
 * account already exists — this only adds a store and the seller role to it.
 */
export function BecomeSellerForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState(becomeSeller, IDLE);

  return (
    <div className="flex flex-col gap-6 px-4 pb-10 pt-safe">
      <header className="flex items-center gap-2 pt-2">
        <Link
          href="/perfil"
          aria-label="Volver al perfil"
          className="-ml-2 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-muted"
        >
          <ChevronLeftIcon className="size-5" />
        </Link>
        <span className="text-sm font-semibold text-subtle">Modo vendedor</span>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
          Creá tu tienda
        </h1>
        <p className="text-pretty text-[15px] leading-relaxed text-subtle">
          Vas a seguir usando la misma cuenta para comprar. Podés cambiar todo esto después.
        </p>
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      <form action={action} className="flex flex-col gap-5">
        <TextInput
          label="Nombre de la tienda"
          name="name"
          required
          maxLength={60}
          defaultValue={defaultName ? `${defaultName.split(' ')[0]} Store` : ''}
          hint="Así te van a encontrar los compradores."
          error={state.fieldErrors?.name?.[0]}
        />
        <SelectField
          label="Rubro"
          name="category"
          defaultValue="moda"
          options={STORE_CATEGORIES.map((category) => ({
            value: category,
            label: STORE_CATEGORY_LABEL[category] ?? category,
          }))}
        />
        <TextInput
          label="Ciudad"
          name="city"
          placeholder="Montevideo"
          hint="Ayuda a coordinar retiros y envíos."
        />
        <TextArea
          label="Descripción"
          name="description"
          rows={3}
          maxLength={400}
          placeholder="Contá en una línea qué vendés y cada cuánto transmitís."
        />

        <Button type="submit" block loading={pending}>
          Crear tienda
        </Button>
      </form>

      <ul className="flex flex-col gap-2 rounded-3xl bg-muted/60 p-4 text-[14px] leading-relaxed text-ink-soft">
        <li>· Sin costo de publicación.</li>
        <li>· Transmitís desde el celular, sin equipo extra.</li>
        <li>· Cobrás con Mercado Pago cuando esté integrado.</li>
      </ul>
    </div>
  );
}
