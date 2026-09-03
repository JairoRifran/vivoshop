'use client';

import { Button, TextInput } from '@vivo/ui';
import { useActionState } from 'react';
import { deleteAccount } from '@/lib/actions/auth';
import { IDLE, type ActionState } from '@/lib/actions/state';

function Notice({ state }: { state: ActionState }) {
  if (state.status !== 'error' || !state.message) return null;
  return (
    <p
      role="alert"
      className="rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger"
    >
      {state.message}
    </p>
  );
}

/**
 * El formulario que borra la cuenta.
 *
 * ## La confirmación es escribir el propio correo
 *
 * No una casilla de tildar —se marca sin leer— ni la contraseña —quien entró
 * con Google no tiene ninguna—. Escribir el correo obliga a mirar **qué cuenta**
 * se está borrando, que es exactamente el error que hay que evitar.
 *
 * El correo va en el `placeholder` y no rellenado: rellenarlo convertiría la
 * confirmación en un botón, que es lo contrario de lo que se busca.
 *
 * `noValidate` porque el navegador validaría el formato de correo antes de
 * enviar y mostraría su propio globo; acá el error que importa no es el formato
 * sino que no coincida, y ese lo dice el servidor.
 */
export function DeleteAccountForm({ email }: { readonly email: string }) {
  const [state, action, pending] = useActionState(deleteAccount, IDLE);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Notice state={state} />

      <TextInput
        label="Escribí tu correo para confirmar"
        name="confirmation"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={email}
        required
      />

      <Button type="submit" variant="danger" loading={pending} block>
        Borrar mi cuenta
      </Button>
    </form>
  );
}
