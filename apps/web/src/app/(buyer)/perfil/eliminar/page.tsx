import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DeleteAccountForm } from '@/components/delete-account-form';
import { api, getCurrentUser, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Borrar la cuenta' };
export const dynamic = 'force-dynamic';

interface Bloqueos {
  canDelete: boolean;
  pendingOrders: number;
  pendingSales: number;
}

/**
 * Borrar la cuenta, desde adentro.
 *
 * La pantalla **pregunta primero** qué se lo impide y recién después dibuja el
 * formulario. Dejar escribir el correo para responder "no se puede, tenés una
 * venta abierta" es hacerle perder el tiempo a alguien que ya tomó una decisión
 * difícil.
 *
 * Si la consulta falla, se asume que **no** se puede borrar. Es el default
 * seguro: ante la duda, no se ejecuta una acción irreversible.
 */
export default async function EliminarCuentaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/ingresar?next=%2Fperfil%2Feliminar');

  const client = await api();
  const bloqueos = await safe(client.request<Bloqueos>('GET', '/auth/account/deletion'), {
    canDelete: false,
    pendingOrders: 0,
    pendingSales: 0,
  });

  return (
    <div className="flex flex-col gap-5 px-4 pt-safe pb-nav">
      <header className="pt-2">
        <h1 className="text-[24px] font-extrabold tracking-tight">Borrar la cuenta</h1>
        <p className="text-[13px] text-subtle">Esto no se puede deshacer.</p>
      </header>

      <section className="flex flex-col gap-2 rounded-3xl bg-surface p-4 shadow-card">
        <h2 className="text-[15px] font-bold">Qué se borra</h2>
        <ul className="flex flex-col gap-1 text-[14px] text-ink-soft">
          <li>· Tu nombre, tu correo, tu teléfono y tu descripción.</li>
          <li>· Tu foto de perfil, incluido el archivo.</li>
          <li>· Tu contraseña y el vínculo con Google, si lo tenías.</li>
          <li>· Las tiendas que seguís y tus avisos.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-3xl border border-line p-4">
        <h2 className="text-[15px] font-bold">Qué queda</h2>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Tus <strong className="text-ink">pedidos y pagos</strong>, porque son el respaldo de una
          operación comercial con otra persona. Y el texto de lo que escribiste en un chat en vivo,
          sin tu nombre ni tu foto: hubo otras personas en esa conversación.
        </p>
        <Link
          href="/eliminar-cuenta"
          className="text-[13px] font-semibold text-brand underline underline-offset-2"
        >
          Ver el detalle completo
        </Link>
      </section>

      {bloqueos.canDelete ? (
        <section className="flex flex-col gap-3">
          <p className="text-[14px] leading-relaxed text-ink-soft">
            Si borrás la cuenta se cierra la sesión al instante. Tu correo queda libre: podés volver
            a registrarte con la misma dirección cuando quieras.
          </p>
          <DeleteAccountForm email={user.email} />
        </section>
      ) : (
        <Pendiente bloqueos={bloqueos} />
      )}
    </div>
  );
}

/**
 * Por qué todavía no se puede.
 *
 * Los dos casos se resuelven de maneras distintas, así que se dicen por
 * separado en vez de con un "tenés cosas pendientes" que no le sirve a nadie.
 */
function Pendiente({ bloqueos }: { bloqueos: Bloqueos }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-warning/10 p-4">
      <h2 className="text-[15px] font-bold text-warning-ink">Todavía no se puede</h2>

      {bloqueos.pendingSales > 0 ? (
        <p className="text-[14px] leading-relaxed text-warning-ink">
          Tenés <strong>{bloqueos.pendingSales}</strong>{' '}
          {bloqueos.pendingSales === 1 ? 'venta sin cerrar' : 'ventas sin cerrar'}. Del otro lado
          hay alguien que pagó y espera su pedido: hay que entregarlo o cancelarlo antes.
        </p>
      ) : null}

      {bloqueos.pendingOrders > 0 ? (
        <p className="text-[14px] leading-relaxed text-warning-ink">
          Tenés <strong>{bloqueos.pendingOrders}</strong>{' '}
          {bloqueos.pendingOrders === 1 ? 'compra en curso' : 'compras en curso'}. Si borrás ahora
          te quedás sin forma de reclamar.
        </p>
      ) : null}

      {bloqueos.pendingSales === 0 && bloqueos.pendingOrders === 0 ? (
        <p className="text-[14px] leading-relaxed text-warning-ink">
          No pudimos comprobar si te queda algo pendiente. Probá de nuevo en un rato, o escribinos a{' '}
          <a href="mailto:hola@vivoshop.live" className="font-semibold underline">
            hola@vivoshop.live
          </a>
          .
        </p>
      ) : null}

      <Link
        href="/compras"
        className="text-[13px] font-semibold text-warning-ink underline underline-offset-2"
      >
        Ver mis pedidos
      </Link>
    </section>
  );
}
