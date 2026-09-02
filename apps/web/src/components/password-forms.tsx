'use client';

import { Button, TextInput } from '@vivo/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { changePassword, requestPasswordReset, resetPassword } from '@/lib/actions/auth';
import { IDLE, type ActionState } from '@/lib/actions/state';

function Notice({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;

  const isError = state.status === 'error';
  return (
    <p
      role={isError ? 'alert' : 'status'}
      className={
        isError
          ? 'rounded-2xl bg-danger/8 px-4 py-3 text-sm font-semibold text-danger'
          : 'rounded-2xl bg-success/10 px-4 py-3 text-sm font-semibold text-success-ink'
      }
    >
      {state.message}
    </p>
  );
}

/**
 * Pedir el enlace de recuperación.
 *
 * Termina en el mismo mensaje siempre, exista o no la cuenta. Distinguir
 * convertiría este formulario en un padrón de quién tiene cuenta acá.
 */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, IDLE);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">¿Olvidaste tu contraseña?</h1>
        <p className="text-[15px] text-subtle">
          Escribí tu email y te mandamos un enlace para elegir una nueva.
        </p>
      </div>

      <Notice state={state} />

      <TextInput
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="ana@vivo.uy"
        required
      />

      <Button type="submit" loading={pending} block>
        Mandame el enlace
      </Button>

      <p className="text-center text-[15px] text-subtle">
        <Link href="/ingresar" className="font-bold text-ink underline underline-offset-4">
          Volver a ingresar
        </Link>
      </p>
    </form>
  );
}

/** Elegir la contraseña nueva, con el token del enlace. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, IDLE);
  const done = state.status === 'success';

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">Elegí una contraseña nueva</h1>
        <p className="text-[15px] text-subtle">
          El enlace sirve una sola vez y vence a la hora de pedirlo.
        </p>
      </div>

      <Notice state={state} />

      <input type="hidden" name="token" value={token} />

      {done ? (
        <Link
          href="/ingresar"
          className="inline-flex h-13 w-full items-center justify-center rounded-2xl bg-ink px-4 text-[15px] font-bold text-surface"
        >
          Ingresar
        </Link>
      ) : (
        <>
          <TextInput
            label="Contraseña nueva"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Al menos 8 caracteres"
            required
          />
          <Button type="submit" loading={pending} block>
            Guardar
          </Button>
        </>
      )}
    </form>
  );
}

/**
 * Cambiar la contraseña estando adentro.
 *
 * `hasPassword` decide qué se pide. A quien entró con Google no se le puede
 * pedir "la actual", porque no existe.
 */
export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(changePassword, IDLE);

  return (
    <form action={action} className="flex flex-col gap-5 rounded-3xl bg-surface p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-extrabold tracking-tight">
          {hasPassword ? 'Cambiar contraseña' : 'Poner una contraseña'}
        </h2>
        <p className="text-[13px] leading-snug text-subtle">
          {hasPassword
            ? 'Al cambiarla se cierran todas tus sesiones, incluida esta.'
            : 'Entraste con Google. Podés agregar una contraseña para entrar también con ella; Google va a seguir funcionando.'}
        </p>
      </div>

      <Notice state={state} />

      {hasPassword ? (
        <TextInput
          label="Contraseña actual"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      ) : null}

      <TextInput
        label="Contraseña nueva"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="Al menos 8 caracteres"
        required
      />

      <Button type="submit" loading={pending} block>
        {hasPassword ? 'Cambiar contraseña' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}
