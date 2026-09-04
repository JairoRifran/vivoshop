import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getCurrentUser } from '@/lib/api';

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s · Panel' },
  // Nada de esto va a un buscador, ni siquiera el 404 que ve quien no entra.
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * El panel del dueño de la plataforma.
 *
 * ## Por qué 404 y no 403
 *
 * A quien no es administrador esta sección no le existe. Un 403 confirma que la
 * ruta existe y que hay algo detrás, y eso es información: le dice a cualquiera
 * que se registre dónde está el panel y que vale la pena insistir. El 404 no
 * dice nada.
 *
 * Es una comodidad de la pantalla, no la seguridad. La seguridad está en la
 * API: `@Roles('admin')` en `AdminController` rechaza el pedido aunque alguien
 * llegue a esta ruta por otro camino. Esto solo evita renderizar un tablero
 * vacío con mensajes de error.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fadmin');
  if (!user.roles.includes('admin')) notFound();

  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl bg-canvas px-4 pb-16 pt-safe">
      <main id="contenido">{children}</main>
    </div>
  );
}
