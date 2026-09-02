import { buttonClasses } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from '@/components/password-forms';

export const metadata: Metadata = { title: 'Nueva contraseña' };
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Sin token no hay nada que hacer acá. Se dice, en vez de mostrar un
  // formulario que va a fallar recién al enviarlo.
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[26px] font-extrabold tracking-tight">Enlace incompleto</h1>
        <p className="text-[15px] text-subtle">
          Abrí el enlace tal como llegó en el correo, o pedí uno nuevo.
        </p>
        <Link
          href="/ingresar/olvide"
          className={buttonClasses({ block: true, className: 'h-13 px-4 text-[15px]' })}
        >
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm token={token} />;
}
