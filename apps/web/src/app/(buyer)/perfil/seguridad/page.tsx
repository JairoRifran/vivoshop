import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/password-forms';
import { api, getCurrentUser, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Seguridad' };
export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fperfil%2Fseguridad');

  const client = await api();
  // Si tiene contraseña decide qué pide el formulario: a quien entró con Google
  // no se le puede pedir "la actual", porque no existe.
  const { hasPassword } = await safe(
    client.request<{ hasPassword: boolean }>('GET', '/auth/password/mine'),
    { hasPassword: true },
  );

  return (
    <div className="flex flex-col gap-5 px-4 pt-safe">
      <header className="pt-2">
        <h1 className="text-[24px] font-extrabold tracking-tight">Seguridad</h1>
        <p className="text-[13px] text-subtle">Cómo entrás a tu cuenta.</p>
      </header>

      <ChangePasswordForm hasPassword={hasPassword} />
    </div>
  );
}
