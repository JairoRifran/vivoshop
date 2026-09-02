import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/auth-forms';
import { SocialSignIn } from '@/components/social-sign-in';
import { getCurrentUser, safe, api } from '@/lib/api';

export const metadata: Metadata = { title: 'Ingresar' };
export const dynamic = 'force-dynamic';

/** Por qué se está viendo esta pantalla, cuando se llegó rebotando de un proveedor. */
const NOTICES: Record<string, string> = {
  verificar:
    'Ya existe una cuenta con ese email. Ingresá con tu contraseña una vez y después vas a poder entrar con Google.',
  social: 'No pudimos completar el ingreso. Probá de nuevo.',
  contrasena: 'Cambiamos tu contraseña y cerramos todas las sesiones. Ingresá de nuevo.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; motivo?: string; error?: string; email?: string }>;
}) {
  const { next, motivo, error, email } = await searchParams;
  if (await getCurrentUser()) redirect(next ?? '/');

  // Qué proveedores hay se lo pregunta a la API en vez de adivinarlo: una
  // instalación sin credenciales de Google no debe mostrar un botón que lleva
  // a un error, y agregar Meta no tiene por qué exigir recompilar la web.
  const client = await api();
  // Las dos son independientes: que haya botones de proveedor no dice nada
  // sobre si hay correo para recuperar, y al reves tampoco.
  const [{ providers }, { canRecover }] = await Promise.all([
    safe(client.request<{ providers: string[] }>('GET', '/auth/providers'), { providers: [] }),
    safe(client.request<{ canRecover: boolean }>('GET', '/auth/password/status'), {
      canRecover: false,
    }),
  ]);

  const notice = NOTICES[motivo ?? ''] ?? NOTICES[error ?? ''];

  return (
    <div className="flex flex-col gap-5">
      {notice ? (
        <p
          role="status"
          className="rounded-2xl bg-info/10 px-4 py-3 text-sm font-semibold text-ink"
        >
          {notice}
        </p>
      ) : null}

      <SignInForm next={next ?? '/'} defaultEmail={email ?? ''} canRecover={canRecover} />
      <SocialSignIn providers={providers} next={next ?? '/'} />
    </div>
  );
}
