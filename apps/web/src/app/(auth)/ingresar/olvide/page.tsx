import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForgotPasswordForm } from '@/components/password-forms';
import { api, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Recuperar contraseña' };
export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage() {
  const client = await api();
  const { canRecover } = await safe(
    client.request<{ canRecover: boolean }>('GET', '/auth/password/status'),
    { canRecover: false },
  );

  // Sin proveedor de correo esta pantalla prometería un email que nunca sale.
  // Un 404 es más honesto que un formulario que no hace nada.
  if (!canRecover) notFound();

  return <ForgotPasswordForm />;
}
