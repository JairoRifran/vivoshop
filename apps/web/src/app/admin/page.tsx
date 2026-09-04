import type { AdminOverviewDto, CurrencyTotalsDto, DailyPointDto } from '@vivo/shared';
import { Badge, buttonClasses } from '@vivo/ui';
import Link from 'next/link';
import { api, safe } from '@/lib/api';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PERIODOS = [
  { dias: 7, label: '7 días' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 365, label: '1 año' },
] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { dias } = await searchParams;
  const pedidos = Number(dias);
  const ventana = PERIODOS.some((p) => p.dias === pedidos) ? pedidos : 30;

  const client = await api();
  const datos = await safe(client.admin.overview({ dias: ventana }), null);

  if (!datos) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-[22px] font-extrabold tracking-tight">No pudimos traer los números</h1>
        <p className="mt-2 text-[14px] text-subtle">
          La API no respondió. Los datos no se guardan en la pantalla, así que recargar alcanza.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-subtle">VivoShop · Administración</p>
          <h1 className="text-[26px] font-extrabold tracking-tight">Panel</h1>
        </div>
        <nav aria-label="Período" className="flex gap-1.5">
          {PERIODOS.map((periodo) => (
            <Link
              key={periodo.dias}
              href={`/admin?dias=${periodo.dias}`}
              aria-current={periodo.dias === ventana ? 'page' : undefined}
              className={
                periodo.dias === ventana
                  ? 'rounded-full bg-ink px-3 py-1.5 text-[13px] font-bold text-white'
                  : 'rounded-full bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-soft shadow-card transition-colors hover:bg-muted'
              }
            >
              {periodo.label}
            </Link>
          ))}
        </nav>
      </header>

      <Dinero datos={datos} />
      <ElVivo datos={datos} />
      <Crecimiento datos={datos} />
      <Atender datos={datos} />
      <Reportes dias={ventana} />

      <p className="text-[12px] text-subtle">
        Días calculados en {datos.timeZone}. Generado el{' '}
        {new Date(datos.generadoEn).toLocaleString('es-UY')}.
      </p>
    </div>
  );
}

// --- Plata -------------------------------------------------------------------

function Dinero({ datos }: { datos: AdminOverviewDto }) {
  const { aprobado, reembolsado, pendiente } = datos.revenue;

  return (
    <Seccion titulo="Plata" nota={`Últimos ${datos.dias} días`}>
      {aprobado.length === 0 ? (
        <Vacio>No hubo cobros aprobados en este período.</Vacio>
      ) : (
        aprobado.map((total) => (
          <div key={total.currency} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {/* La comisión primero y más grande: de todo lo que se mueve acá,
                  es lo único que es ingreso de VivoShop. El bruto es plata de
                  otra gente pasando por el sistema. */}
              <Cifra
                destacada
                etiqueta="Tu comisión"
                valor={money(total.commissionMinor, total.currency)}
                nota={`${total.count} ${total.count === 1 ? 'cobro' : 'cobros'}`}
              />
              <Cifra
                etiqueta="Volumen (GMV)"
                valor={money(total.grossMinor, total.currency)}
                nota="Lo que pagaron los compradores"
              />
              <Cifra
                etiqueta="A los vendedores"
                valor={money(total.netMinor, total.currency)}
                nota="Lo que no es tuyo"
              />
              <Cifra
                etiqueta="Ticket promedio"
                valor={money(Math.round(total.grossMinor / total.count), total.currency)}
                nota="Por cobro aprobado"
              />
            </div>
          </div>
        ))
      )}

      <div className="grid grid-cols-2 gap-3">
        <Cifra
          etiqueta="Devuelto"
          valor={sumaLegible(reembolsado)}
          nota={`${contar(reembolsado)} reembolsos`}
          tono={contar(reembolsado) > 0 ? 'alerta' : undefined}
        />
        <Cifra
          etiqueta="Sin resolver"
          valor={sumaLegible(pendiente)}
          nota={`${contar(pendiente)} cobros esperando`}
        />
      </div>

      <Serie puntos={datos.serie} />
    </Seccion>
  );
}

/**
 * El gráfico, con divs.
 *
 * Sin librería a propósito: son treinta barras y una escala. Traer una de
 * gráficos costaría más kilobytes que toda esta página y obligaría a que fuera
 * un componente de cliente, cuando esto se puede renderizar entero en el
 * servidor.
 */
function Serie({ puntos }: { puntos: readonly DailyPointDto[] }) {
  if (puntos.length === 0) return null;
  const maximo = Math.max(...puntos.map((p) => p.grossMinor));
  if (maximo <= 0) return null;

  return (
    <figure className="flex flex-col gap-2 rounded-3xl bg-surface p-4 shadow-card">
      <figcaption className="text-[13px] font-bold text-ink-soft">Cobrado por día</figcaption>
      <div className="flex h-28 items-end gap-1 overflow-x-auto">
        {puntos.map((punto) => (
          <div
            key={`${punto.dia}-${punto.currency}`}
            className="flex min-w-1.5 flex-1 flex-col justify-end"
            title={`${punto.dia}: ${money(punto.grossMinor, punto.currency)} (${punto.count})`}
          >
            <div
              className="rounded-t bg-brand"
              style={{ height: `${Math.max(3, (punto.grossMinor / maximo) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-subtle">
        <span>{puntos[0]?.dia}</span>
        <span>{puntos[puntos.length - 1]?.dia}</span>
      </div>
    </figure>
  );
}

// --- El vivo -----------------------------------------------------------------

function ElVivo({ datos }: { datos: AdminOverviewDto }) {
  const { enVivo, fueraDeVivo, sesionesRealizadas, espectadores, conversionBps } = datos.vivo;
  const totalVivo = enVivo.reduce((s, t) => s + t.grossMinor, 0);
  const totalFuera = fueraDeVivo.reduce((s, t) => s + t.grossMinor, 0);
  const suma = totalVivo + totalFuera;
  const porcentaje = suma > 0 ? Math.round((totalVivo / suma) * 100) : 0;

  return (
    <Seccion titulo="El vivo" nota="Si esto no crece, VivoShop es una tienda con video">
      {suma === 0 ? (
        <Vacio>No hubo pedidos en este período.</Vacio>
      ) : (
        <>
          <div
            className="flex h-3 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${porcentaje}% de las ventas salió de un vivo`}
          >
            <div className="bg-live" style={{ width: `${porcentaje}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra
              destacada
              etiqueta="Desde un vivo"
              valor={`${porcentaje}%`}
              nota={sumaLegible(enVivo)}
            />
            <Cifra
              etiqueta="Fuera del vivo"
              valor={`${100 - porcentaje}%`}
              nota={sumaLegible(fueraDeVivo)}
            />
            <Cifra
              etiqueta="Transmisiones"
              valor={String(sesionesRealizadas)}
              nota={`${espectadores} espectadores`}
            />
            <Cifra
              etiqueta="Conversión"
              valor={`${(conversionBps / 100).toFixed(2)}%`}
              nota="Pedidos por espectador"
            />
          </div>
        </>
      )}
    </Seccion>
  );
}

// --- Crecimiento -------------------------------------------------------------

function Crecimiento({ datos }: { datos: AdminOverviewDto }) {
  const c = datos.crecimiento;
  return (
    <Seccion titulo="Crecimiento">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra
          etiqueta="Cuentas"
          valor={String(c.usuariosTotal)}
          nota={`+${c.usuariosNuevos} nuevas`}
        />
        <Cifra
          etiqueta="Tiendas"
          valor={String(c.tiendasTotal)}
          nota={`+${c.tiendasNuevas} nuevas`}
        />
        <Cifra
          etiqueta="Tiendas que venden"
          valor={String(c.tiendasConVentas)}
          nota={`de ${c.tiendasTotal}`}
        />
        {/* Una tienda registrada que nunca publicó nada es alguien que se
            anotó y se fue. Es la fuga que más barato sale de arreglar. */}
        <Cifra
          etiqueta="Sin publicar nada"
          valor={String(c.tiendasSinProductos)}
          nota="Se anotaron y no siguieron"
          tono={c.tiendasSinProductos > 0 ? 'alerta' : undefined}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{c.tiendasActivas} activas</Badge>
        <Badge tone="neutral">{c.tiendasPausadas} pausadas</Badge>
        {c.tiendasSuspendidas > 0 ? (
          <Badge tone="danger">{c.tiendasSuspendidas} suspendidas</Badge>
        ) : null}
      </div>
    </Seccion>
  );
}

// --- Atender -----------------------------------------------------------------

function Atender({ datos }: { datos: AdminOverviewDto }) {
  const a = datos.atencion;
  const nadaQueHacer =
    a.disputasAbiertas === 0 &&
    a.pedidosTrabados === 0 &&
    a.pagosFallidos === 0 &&
    a.verificacionesPendientes === 0 &&
    a.denunciasAbiertas === 0;

  return (
    <Seccion titulo="Para atender" nota="Cosas que esperan algo tuyo">
      {nadaQueHacer ? (
        <Vacio>Nada pendiente.</Vacio>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra
            etiqueta="Disputas abiertas"
            valor={String(a.disputasAbiertas)}
            tono={a.disputasAbiertas > 0 ? 'alerta' : undefined}
          />
          <Cifra
            etiqueta="Pedidos trabados"
            valor={String(a.pedidosTrabados)}
            nota={`Pagos hace +${a.diasTrabado} días, sin despachar`}
            tono={a.pedidosTrabados > 0 ? 'alerta' : undefined}
          />
          <Cifra etiqueta="Pagos rechazados" valor={String(a.pagosFallidos)} />
          <Cifra etiqueta="Verificaciones" valor={String(a.verificacionesPendientes)} />
          {/* Las denuncias van acá y no en una pantalla aparte: la política de
              contenido de usuarios de Play no pide solo el botón de denunciar,
              pide que alguien las mire. Si no aparecen donde mirás todos los
              días, no las mira nadie. */}
          <Cifra
            etiqueta="Denuncias"
            valor={String(a.denunciasAbiertas)}
            nota="Contenido reportado sin revisar"
            tono={a.denunciasAbiertas > 0 ? 'alerta' : undefined}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {Object.entries(a.pedidosPorEstado)
          .filter(([, cantidad]) => cantidad > 0)
          .map(([estado, cantidad]) => (
            <Badge key={estado} tone="neutral">
              {ESTADO_PEDIDO[estado] ?? estado}: {cantidad}
            </Badge>
          ))}
      </div>
    </Seccion>
  );
}

const ESTADO_PEDIDO: Record<string, string> = {
  pending_payment: 'Esperando pago',
  paid: 'Pagados',
  preparing: 'Preparando',
  shipped: 'Enviados',
  delivered: 'Entregados',
  completed: 'Completados',
  cancelled: 'Cancelados',
};

// --- Reportes ----------------------------------------------------------------

function Reportes({ dias }: { dias: number }) {
  return (
    <Seccion titulo="Reportes" nota="Para la planilla y para el contador">
      <div className="flex flex-wrap gap-2">
        <a
          href={`/admin/reportes/pedidos?dias=${dias}`}
          className={buttonClasses({ size: 'md' })}
          download
        >
          Pedidos (CSV)
        </a>
        <a
          href={`/admin/reportes/cobros?dias=${dias}`}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
          download
        >
          Cobros y comisiones (CSV)
        </a>
      </div>
      <p className="text-[12px] text-subtle">
        Salen con el mismo período que estás mirando. Los montos van en decimal, con punto.
      </p>
    </Seccion>
  );
}

// --- Piezas ------------------------------------------------------------------

function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-extrabold tracking-tight">{titulo}</h2>
        {nota ? <p className="text-[12px] text-subtle">{nota}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Cifra({
  etiqueta,
  valor,
  nota,
  destacada = false,
  tono,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  destacada?: boolean;
  tono?: 'alerta';
}) {
  return (
    <div
      className={
        destacada
          ? 'rounded-3xl bg-ink px-4 py-3.5 text-white shadow-card'
          : 'rounded-3xl bg-surface px-4 py-3.5 shadow-card'
      }
    >
      <p
        className={
          destacada
            ? 'text-[11px] font-bold uppercase tracking-wide text-white/60'
            : 'text-[11px] font-bold uppercase tracking-wide text-subtle'
        }
      >
        {etiqueta}
      </p>
      <p
        className={`text-[22px] font-extrabold leading-tight ${
          tono === 'alerta' && !destacada ? 'text-danger' : ''
        }`}
      >
        {valor}
      </p>
      {nota ? (
        <p className={destacada ? 'text-[12px] text-white/70' : 'text-[12px] text-subtle'}>
          {nota}
        </p>
      ) : null}
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-3xl bg-surface px-4 py-6 text-center text-[14px] text-subtle shadow-card">
      {children}
    </p>
  );
}

/**
 * Varias monedas en una línea, sin sumarlas.
 *
 * Sumar UYU con otra cosa daría un número que no significa nada. Hoy siempre va
 * a devolver una sola, pero el día que entre el segundo país esto sigue siendo
 * cierto en vez de empezar a mentir.
 */
function sumaLegible(totales: readonly CurrencyTotalsDto[]): string {
  if (totales.length === 0) return money(0, 'UYU');
  return totales.map((total) => money(total.grossMinor, total.currency)).join(' · ');
}

function contar(totales: readonly CurrencyTotalsDto[]): number {
  return totales.reduce((suma, total) => suma + total.count, 0);
}
