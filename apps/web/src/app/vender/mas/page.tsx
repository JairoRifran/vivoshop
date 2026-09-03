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

      <section className="flex flex-col gap-2 px-4">
        <h2 className="text-[17px] font-extrabold tracking-tight">Cobros y confianza</h2>
        <div className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
          <Entry
            href="/vender/cobros"
            label="Cobros"
            note="Cómo recibís el dinero de tus ventas"
          />
          <Entry
            href="/vender/verificacion"
            label="Verificación"
            /* "Opcional" en la propia entrada del menú: es donde alguien decide
               si tiene que entrar, y no queremos que crea que sí. */
            note={store.isVerified ? 'Tu tienda está verificada' : 'Opcional — para el ✓'}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4 pb-2">
        <h2 className="text-[17px] font-extrabold tracking-tight">Próximamente</h2>
        <ul className="flex flex-col divide-y divide-line rounded-3xl bg-surface px-4 shadow-card">
          {/*
            Acá decía además "Notificaciones push" y "Modo puja en vivo", y las
            dos ya están hechas: push en M05 —`NotificationService` y el flujo
            de suscripción— y las pujas en M04, con `BidService` y pruebas de
            punta a punta que corren en cada commit.

            Una lista de "próximamente" que promete lo que el producto ya hace
            es peor que no tenerla: al vendedor que la lee le dice que le falta
            algo que en realidad tiene, y deja de buscarlo.

            Si se agrega algo acá, se saca el día que se entrega.
          */}
          <Upcoming label="Etiquetas de envío" />
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

function Entry({ href, label, note }: { href: string; label: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 py-3.5 transition-colors hover:bg-muted/50"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-bold">{label}</span>
        <span className="block truncate text-[13px] text-subtle">{note}</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-subtle" />
    </Link>
  );
}

/**
 * Una fila de "próximamente".
 *
 * `note` es opcional a propósito. Antes era obligatoria y las tres filas
 * llevaban un badge que decía "M04": el código de un hito interno, que a quien
 * vende no le significa nada. Un badge solo vale la pena si dice algo que la
 * persona pueda usar —una fecha, un estado—; si no, es ruido con forma de dato.
 */
function Upcoming({ label, note }: { label: string; note?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3.5">
      <span className="text-[14px] text-ink-soft">{label}</span>
      {note ? <Badge tone="neutral">{note}</Badge> : null}
    </li>
  );
}
