'use client';

import { Button, TextInput } from '@vivo/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import { signIn, signUp } from '@/lib/actions/auth';
import { IDLE, type ActionState } from '@/lib/actions/state';

function FormError({ state }: { state: ActionState }) {
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

/** First error for a field, so the input shows one clear sentence at a time. */
function fieldError(state: ActionState, field: string): string | undefined {
  return state.fieldErrors?.[field]?.[0];
}

export function SignInForm({ next, defaultEmail = '' }: { next: string; defaultEmail?: string }) {
  const [state, action, pending] = useActionState(signIn, IDLE);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">Ingresá a tu cuenta</h1>
        <p className="text-[15px] text-subtle">
          Una sola cuenta para comprar y para vender.
        </p>
      </div>

      <FormError state={state} />

      <input type="hidden" name="next" value={next} />

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
        // Precargado cuando se llega rebotando de un proveedor que no verificó
        // el email: la persona ya escribió su email allá, pedírselo de nuevo
        // sería castigarla por nuestra regla de seguridad.
        defaultValue={defaultEmail}
        error={fieldError(state, 'email')}
      />
      <TextInput
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        error={fieldError(state, 'password')}
      />

      <Button type="submit" loading={pending} block>
        Ingresar
      </Button>

      <p className="text-center text-[15px] text-subtle">
        ¿No tenés cuenta?{' '}
        <Link
          href={`/crear-cuenta?next=${encodeURIComponent(next)}`}
          className="font-bold text-ink underline underline-offset-4"
        >
          Creala gratis
        </Link>
      </p>

      <DemoAccounts />
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUp, IDLE);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-extrabold tracking-tight">Creá tu cuenta</h1>
        <p className="text-[15px] text-subtle">
          Seguí tiendas, comprá en vivo y activá el modo vendedor cuando quieras.
        </p>
      </div>

      <FormError state={state} />

      <input type="hidden" name="next" value={next} />

      <TextInput
        label="Nombre y apellido"
        name="name"
        autoComplete="name"
        placeholder="Ana Pérez"
        required
        error={fieldError(state, 'name')}
      />
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
        error={fieldError(state, 'email')}
      />
      <TextInput
        label="Teléfono"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="099 123 456"
        hint="Opcional. Lo usamos para coordinar entregas."
        error={fieldError(state, 'phone')}
      />
      <TextInput
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="Al menos 8 caracteres"
        required
        error={fieldError(state, 'password')}
      />

      <Button type="submit" loading={pending} block>
        Crear cuenta
      </Button>

      <p className="text-center text-[15px] text-subtle">
        ¿Ya tenés cuenta?{' '}
        <Link
          href={`/ingresar?next=${encodeURIComponent(next)}`}
          className="font-bold text-ink underline underline-offset-4"
        >
          Ingresá
        </Link>
      </p>
    </form>
  );
}

/**
 * Demo credentials, shown only outside production. Reviewing a live commerce
 * product means seeing both sides, and hunting for a password in a README is
 * a bad first impression.
 */
function DemoAccounts() {
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="rounded-2xl border border-dashed border-line bg-muted/50 px-4 py-3 text-[13px] leading-relaxed text-subtle">
      <p className="font-bold text-ink-soft">Cuentas de demostración</p>
      <p>
        Compradora: <code className="font-semibold">ana@vivo.uy</code>
      </p>
      <p>
        Vendedora: <code className="font-semibold">martina@vivo.uy</code>
      </p>
      <p>
        Contraseña: <code className="font-semibold">vivo1234</code>
      </p>
    </div>
  );
}
