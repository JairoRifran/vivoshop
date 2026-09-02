import { Avatar, Badge, buttonClasses, EmptyState } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { StoreRow } from '@/components/cards';
import { BagIcon, BroadcastIcon, ChevronRightIcon, StoreIcon, UserIcon } from '@/components/icons';
import { SignOutButton } from '@/components/sign-out-button';
import { api, getCurrentUser, safe } from '@/lib/api';

export const metadata: Metadata = { title: 'Perfil' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-col gap-6 px-4 pt-safe">
        <h1 className="pt-2 text-[26px] font-extrabold tracking-tight">Perfil</h1>
        <EmptyState
          icon={<UserIcon className="size-8" />}
          title="Ingresá a tu cuenta"
          description="Guardá tus compras, seguí tiendas y activá el modo vendedor cuando quieras."
          action={
            <div className="flex gap-2">
              <Link
                href="/ingresar?next=%2Fperfil"
                className={buttonClasses({ size: 'md', className: 'px-5 text-sm' })}
              >
                Ingresar
              </Link>
              <Link
                href="/crear-cuenta?next=%2Fperfil"
                className="inline-flex h-11 items-center rounded-2xl border border-line bg-surface px-5 text-sm font-bold text-ink"
              >
                Crear cuenta
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const client = await api();
  const [following, store, orders] = await Promise.all([
    safe(client.stores.following(), []),
    safe(client.stores.mine(), null),
    safe(client.orders.mine(), []),
  ]);

  const isSeller = user.roles.includes('seller');

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="flex flex-col gap-3 px-4 pt-2">
        <div className="flex items-center gap-3">
          <Avatar src={user.avatarUrl} name={user.name} size={60} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-extrabold tracking-tight">{user.name}</h1>
            <p className="truncate text-[13px] text-subtle">{user.email}</p>
          </div>
          {isSeller ? <Badge tone="neutral">Vendedor</Badge> : null}
        </div>

        {user.bio ? <p className="text-[14px] leading-snug text-ink">{user.bio}</p> : null}

        <Link
          href="/perfil/editar"
          className="inline-flex h-10 items-center justify-center self-start rounded-2xl border border-line bg-surface px-4 text-[14px] font-bold text-ink transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Editar perfil
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 px-4">
        <Link
          href="/compras"
          className="flex flex-col gap-1 rounded-3xl bg-surface p-4 shadow-card transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <BagIcon className="size-5 text-subtle" />
          <span className="text-[19px] font-extrabold leading-none">{orders.length}</span>
          <span className="text-[13px] text-subtle">Compras</span>
        </Link>
        <div className="flex flex-col gap-1 rounded-3xl bg-surface p-4 shadow-card">
          <BroadcastIcon className="size-5 text-subtle" />
          <span className="text-[19px] font-extrabold leading-none">{following.length}</span>
          <span className="text-[13px] text-subtle">Tiendas que sigo</span>
        </div>
      </section>

      {/* --- Seller mode ------------------------------------------------------ */}
      <section className="px-4">
        {store ? (
          <Link
            href="/vender"
            className="flex items-center gap-3 rounded-3xl bg-ink px-4 py-4 text-surface transition-transform active:scale-[0.99] motion-reduce:active:scale-100"
          >
            <Avatar src={store.logoUrl} name={store.name} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-surface/60">
                Modo vendedor
              </p>
              <p className="truncate text-[16px] font-extrabold">{store.name}</p>
            </div>
            <ChevronRightIcon className="size-5 shrink-0 text-surface/70" />
          </Link>
        ) : (
          <Link
            href="/vender"
            className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-4 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-ink text-surface">
              <StoreIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold">Activar modo vendedor</p>
              <p className="text-[13px] leading-snug text-subtle">
                Creá tu tienda y transmití desde el celular. Seguís usando la misma cuenta.
              </p>
            </div>
            <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
          </Link>
        )}
      </section>

      {following.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="px-4 text-[17px] font-extrabold tracking-tight">Tiendas que sigo</h2>
          <div className="flex flex-col divide-y divide-line px-4">
            {following.map((item) => (
              <StoreRow key={item.id} store={item} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 px-4 pb-2">
        <h2 className="text-[17px] font-extrabold tracking-tight">Cuenta</h2>
        <dl className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
          <Row label="Teléfono" value={user.phone ?? 'Sin teléfono'} />
          <Row label="País" value={user.country === 'UY' ? 'Uruguay' : user.country} />
          <Row label="Roles" value={user.roles.join(', ')} />
        </dl>
        <Link
          href="/perfil/seguridad"
          className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-4 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">Seguridad</p>
            <p className="text-[13px] leading-snug text-subtle">
              Tu contraseña y cómo entrás a la cuenta.
            </p>
          </div>
          <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
        </Link>
        <SignOutButton />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3.5">
      <dt className="text-[14px] text-subtle">{label}</dt>
      <dd className="truncate text-[14px] font-semibold">{value}</dd>
    </div>
  );
}
