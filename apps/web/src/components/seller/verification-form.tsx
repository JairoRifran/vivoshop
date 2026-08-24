'use client';

import type { VerificationStatusDto } from '@vivo/shared';
import { Badge, Button, TextInput } from '@vivo/ui';
import { useActionState } from 'react';
import { submitBusinessVerification } from '@/lib/actions/payments';
import { IDLE } from '@/lib/actions/state';

/**
 * El formulario del ✓, que nadie está obligado a completar.
 *
 * El encabezado lo dice antes que cualquier otra cosa, y no es cortesía: el
 * riesgo real de esta pantalla es que un vendedor particular la lea y crea que
 * tiene que formalizarse para seguir vendiendo. Vender, transmitir y cobrar ya
 * funcionan sin nada de esto.
 */
export function VerificationForm({ current }: { current: VerificationStatusDto | null }) {
  const [state, action, pending] = useActionState(submitBusinessVerification, IDLE);
  const status = current?.status ?? 'unverified';

  if (status === 'verified') {
    return (
      <section className="flex flex-col gap-2 rounded-3xl bg-success/8 p-4">
        <Badge tone="success">Tienda verificada</Badge>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Confirmamos la identidad comercial y los datos de tu negocio. El ✓ aparece junto al
          nombre de tu tienda en toda la app.
        </p>
      </section>
    );
  }

  if (status === 'pending') {
    return (
      <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4 shadow-card">
        <Badge tone="warning">En revisión</Badge>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Recibimos tus datos y los estamos revisando. Te avisamos cuando terminemos. Mientras
          tanto podés seguir vendiendo con normalidad.
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-card">
      <div>
        <h2 className="text-[17px] font-extrabold tracking-tight">Verificá tu negocio</h2>
        <p className="text-[13px] leading-relaxed text-subtle">
          Es opcional. Sirve para mostrar el ✓ junto al nombre de tu tienda y entrar en el filtro
          de tiendas verificadas. Si vendés como particular no necesitás hacer nada de esto.
        </p>
      </div>

      {status === 'rejected' && current?.rejectionReason ? (
        <p role="alert" className="rounded-2xl bg-warning/10 px-4 py-3 text-[13px] text-ink-soft">
          No pudimos verificarla: {current.rejectionReason}. Corregí el dato y volvé a enviarla.
        </p>
      ) : null}

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

      <TextInput label="Razón social" name="legalName" required maxLength={120} />
      <TextInput
        label="RUT"
        name="taxId"
        required
        inputMode="numeric"
        maxLength={24}
        hint="Solo lo pedimos para verificar el negocio. No hace falta para vender."
      />
      <TextInput label="Responsable" name="responsibleName" required maxLength={120} />
      <TextInput label="Documento del responsable" name="responsibleDocument" required maxLength={32} />
      <TextInput label="Domicilio comercial" name="commercialAddress" required maxLength={200} />
      <TextInput label="Teléfono de contacto" name="contactPhone" required type="tel" maxLength={24} />
      <TextInput label="Correo de contacto" name="contactEmail" required type="email" maxLength={160} />

      <p className="text-[12px] leading-relaxed text-subtle">
        Estos datos no se muestran en público. Los usamos solo para verificar el negocio.
      </p>

      <Button type="submit" block loading={pending}>
        Enviar para revisión
      </Button>
    </form>
  );
}
