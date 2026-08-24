import { Badge } from '@vivo/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRightIcon } from '@/components/icons';
import { SignOutButton } from '@/components/sign-out-button';
import { StoreSettingsForm } from '@/components/seller/store-settings-form';
import { api, safe } from '@/lib/api';
import { STORE_CATEGORY_LABEL, money } from '@/lib/format';

export const metadata: Metadata = { title: 'Más' };
export const dynamic = 'force-dynamic';

export default async function SellerMorePage() {
  const client = await api();
  const store = await safe(client.stores.mine(), null);
  if (!store) return null;

  return (
    <div className="flex flex-col gap-6 pt-safe">
      <header className="px-4 pt-3">
        <h1 className="text-[24px] font-extrabold tracking-tight">Configuración</h1>
        <p className="text-[13px] text-subtle">Datos de {store.name}</p>
      </header>

      <section className="mx-4 grid grid-cols-3 gap-2">
        <Stat label="Reputación" value={`★ ${store.rating.toFixed(1)}`} />
        <Stat label="Seguidores" value={store.followerCount.toLocaleString('es-UY')} />
        <Stat label="Ventas" value={store.salesCount.toLocaleString('es-UY')} />
      </section>

      <section className="px-4">
        <StoreSettingsForm store={store} />
      </section>

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-[17px] font-extrabold tracking-tight">Tu tienda</h2>
        <dl className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
          <Row label="Dirección pública" value={`/tienda/${store.slug}`} />
          <Row label="Rubro" value={STORE_CATEGORY_LABEL[store.category] ?? store.category} />
          <Row label="Moneda" value={store.currency} />
          <Row
            label="Envío gratis desde"
            value={
              store.freeShippingThresholdMinor
                ? money(store.freeShippingThresholdMinor, store.currency)
                : 'Sin umbral'
            }
          />
        </dl>
      </section>

      <section className="flex flex-col gap-2 px-4 pb-2">
        <h2 className="text-[17px] font-extrabold tracking-tight">Próximamente</h2>
        <ul className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
          <Upcoming label="Cobros con Mercado Pago" note="M02" />
          <Upcoming label="Transmisión de video real" note="M02" />
          <Upcoming label="Etiquetas de envío" note="M03" />
          <Upcoming label="Notificaciones push" note="M03" />
        </ul>

        <Link
          href="/"
          className="mt-2 inline-flex h-13 w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 text-[15px] font-bold text-ink transition-colors hover:bg-muted"
        >
          Volver al modo comprador
          <ChevronRightIcon className="size-5 text-subtle" />
        </Link>
        <SignOutButton />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface px-3 py-2.5 text-center shadow-card">
      <p className="text-[17px] font-extrabold leading-tight">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</p>
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

function Upcoming({ label, note }: { label: string; note: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3.5">
      <span className="text-[14px] text-ink-soft">{label}</span>
      <Badge tone="neutral">{note}</Badge>
    </li>
  );
}
