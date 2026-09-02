import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignUpForm } from '@/components/auth-forms';
import { SocialSignIn } from '@/components/social-sign-in';
import { api, getCurrentUser, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Crear cuenta' };
export const dynamic = 'force-dynamic';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(next ?? '/');

  const client = await api();
  const { providers } = await safe(
    client.request<{ providers: string[] }>('GET', '/auth/providers'),
    { providers: [] },
  );

  return (
    <div className="flex flex-col gap-5">
      <SignUpForm next={next ?? '/'} />
      {/*
        Los mismos botones que en "Ingresar", y no una variante que diga
        "Registrarse con Google". Con un proveedor no hay diferencia: el mismo
        gesto crea la cuenta si no existe y entra si ya existe. Prometer dos
        cosas distintas donde hay una sola es cómo alguien termina creyendo que
        tiene dos cuentas.
      */}
      <SocialSignIn providers={providers} next={next ?? '/'} />
    </div>
  );
}
