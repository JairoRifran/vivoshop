import { Inject, Injectable } from '@nestjs/common';
import {
  DISPUTE_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type DisputeStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@vivo/domain';
import type { CurrencyCode } from '@vivo/config';
import { and, asc, eq, gte, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  LIMITE_REPORTE,
  type AttentionSnapshot,
  type CurrencyTotals,
  type DailyPoint,
  type GrowthSnapshot,
  type LiveImpact,
  type MetricsRepository,
  type MetricsWindow,
  type OrderReportRow,
  type PaymentReportRow,
  type ReportPage,
  type RevenueSnapshot,
} from '../../../application/ports/metrics';
import { DRIZZLE, type VivoDatabase } from './client';
import { schema as t } from './schema';

/**
 * `sum()` de Postgres vuelve como texto, y como `null` si no sumó ninguna fila.
 *
 * El driver `pg` mapea `bigint` a string a propósito, porque un bigint no entra
 * en un `number` de JavaScript. Acá entra: son centavos de una plataforma, no
 * hay riesgo de pasar los 9.007.199.254.740.991. Pero hay que convertirlo, y un
 * `null` no convertido se propaga como `NaN` hasta la pantalla.
 */
function aNumero(valor: unknown): number {
  if (valor === null || valor === undefined) return 0;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : 0;
}

interface FilaTotales {
  currency: string;
  gross: unknown;
  commission: unknown;
  net: unknown;
  count: unknown;
}

/*
 * La moneda vuelve como `text` y el dominio la quiere como `CurrencyCode`.
 *
 * El casteo va acá, en el borde de persistencia, que es donde ya se hace lo
 * mismo con los estados: adentro del sistema los tipos valen, y la única
 * frontera donde entra texto sin validar es esta.
 */
function aTotales(filas: readonly FilaTotales[]): CurrencyTotals[] {
  return filas
    .map((fila) => ({
      currency: fila.currency as CurrencyCode,
      grossMinor: aNumero(fila.gross),
      commissionMinor: aNumero(fila.commission),
      netMinor: aNumero(fila.net),
      count: aNumero(fila.count),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function contarPor<T extends string>(claves: readonly T[]): Record<T, number> {
  return Object.fromEntries(claves.map((clave) => [clave, 0])) as Record<T, number>;
}

/**
 * Las métricas contra Postgres, agregadas en la base.
 *
 * Todo lo que devuelve son totales, nunca listas de entidades —salvo las dos
 * exportaciones, que declaran su corte—. La razón está en el puerto: los
 * `list()` de los repositorios truncan en 100 filas y sumar sobre eso daría
 * plata de menos sin ningún aviso.
 */
@Injectable()
export class DrizzleMetricsRepository implements MetricsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: VivoDatabase) {}

  async revenue(window: MetricsWindow): Promise<RevenueSnapshot> {
    const totalesPor = async (condicion: ReturnType<typeof and>): Promise<CurrencyTotals[]> => {
      const filas = await this.db
        .select({
          currency: t.payments.currency,
          gross: sql<string>`coalesce(sum(${t.payments.grossMinor}), 0)`,
          commission: sql<string>`coalesce(sum(${t.payments.commissionMinor}), 0)`,
          net: sql<string>`coalesce(sum(${t.payments.netMinor}), 0)`,
          count: sql<string>`count(*)`,
        })
        .from(t.payments)
        .where(condicion)
        .groupBy(t.payments.currency);
      return aTotales(filas);
    };

    // Cada eje por su propia fecha: aprobado por `approved_at`, reembolsado por
    // `refunded_at`. Un cobro de marzo devuelto en abril cae en marzo en un eje
    // y en abril en el otro, que es lo correcto.
    const [aprobado, reembolsado, pendiente, estados] = await Promise.all([
      totalesPor(
        and(
          eq(t.payments.status, 'approved'),
          gte(t.payments.approvedAt, window.desde),
          lt(t.payments.approvedAt, window.hasta),
        ),
      ),
      totalesPor(
        and(
          eq(t.payments.status, 'refunded'),
          gte(t.payments.refundedAt, window.desde),
          lt(t.payments.refundedAt, window.hasta),
        ),
      ),
      totalesPor(
        and(
          eq(t.payments.status, 'pending'),
          gte(t.payments.createdAt, window.desde),
          lt(t.payments.createdAt, window.hasta),
        ),
      ),
      this.db
        .select({ status: t.payments.status, count: sql<string>`count(*)` })
        .from(t.payments)
        .where(and(gte(t.payments.createdAt, window.desde), lt(t.payments.createdAt, window.hasta)))
        .groupBy(t.payments.status),
    ]);

    const porEstado = contarPor<PaymentStatus>(PAYMENT_STATUSES);
    for (const fila of estados) {
      // Un estado que la base tenga y el dominio no se descarta en vez de
      // agregar una clave que nadie sabe leer.
      if (fila.status in porEstado) porEstado[fila.status as PaymentStatus] = aNumero(fila.count);
    }

    return { aprobado, reembolsado, pendiente, porEstado };
  }

  async revenueByDay(window: MetricsWindow): Promise<readonly DailyPoint[]> {
    // `AT TIME ZONE` pasa el `timestamptz` a la hora del mercado antes de
    // recortar el día. Sin eso agruparía por el huso del servidor, que en
    // producción es UTC, y una venta de las 21:30 de Montevideo aparecería al
    // día siguiente. Ver la nota de `timeZone` en el puerto.
    //
    // La zona va como parámetro (`$1`), no interpolada en el texto de la
    // consulta. Hoy sale de una constante de `@vivo/config` y no habría
    // diferencia, pero el día que alguien la haga configurable —un selector de
    // huso en el panel— la versión interpolada sería inyección de SQL y esta no.
    const dia = sql<string>`to_char(${t.payments.approvedAt} at time zone ${window.timeZone}::text, 'YYYY-MM-DD')`;

    const filas = await this.db
      .select({
        dia,
        currency: t.payments.currency,
        gross: sql<string>`coalesce(sum(${t.payments.grossMinor}), 0)`,
        commission: sql<string>`coalesce(sum(${t.payments.commissionMinor}), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(t.payments)
      .where(
        and(
          eq(t.payments.status, 'approved'),
          gte(t.payments.approvedAt, window.desde),
          lt(t.payments.approvedAt, window.hasta),
        ),
      )
      // Se agrupa por posición —`group by 1, 2`— y no repitiendo la expresión.
      //
      // Repetirla no funciona: la zona horaria va como parámetro, así que la
      // misma expresión sale con un placeholder distinto en el `select` y en el
      // `group by` ($1 y $5), PostgreSQL no las reconoce como la misma y falla
      // con "column must appear in the GROUP BY clause". El ordinal apunta a la
      // columna ya proyectada, que es exactamente lo que se quiere agrupar.
      .groupBy(sql`1`, sql`2`);

    return filas
      .map((fila) => ({
        dia: fila.dia,
        currency: fila.currency as CurrencyCode,
        grossMinor: aNumero(fila.gross),
        commissionMinor: aNumero(fila.commission),
        count: aNumero(fila.count),
      }))
      .sort((a, b) => a.dia.localeCompare(b.dia) || a.currency.localeCompare(b.currency));
  }

  async liveImpact(window: MetricsWindow): Promise<LiveImpact> {
    const enVentana = and(
      gte(t.orders.createdAt, window.desde),
      lt(t.orders.createdAt, window.hasta),
      // Un pedido cancelado no es venta; contarlo inflaría los dos lados.
      ne(t.orders.status, 'cancelled'),
    );

    const totalesPedidos = async (deVivo: boolean): Promise<CurrencyTotals[]> => {
      const filas = await this.db
        .select({
          currency: t.orders.currency,
          gross: sql<string>`coalesce(sum(${t.orders.totalMinor}), 0)`,
          commission: sql<string>`0`,
          net: sql<string>`0`,
          count: sql<string>`count(*)`,
        })
        .from(t.orders)
        .where(
          and(
            enVentana,
            deVivo ? isNotNull(t.orders.liveSessionId) : sql`${t.orders.liveSessionId} is null`,
          ),
        )
        .groupBy(t.orders.currency);
      return aTotales(filas);
    };

    const [enVivo, fueraDeVivo, sesiones] = await Promise.all([
      totalesPedidos(true),
      totalesPedidos(false),
      this.db
        .select({
          count: sql<string>`count(*)`,
          espectadores: sql<string>`coalesce(sum(${t.liveSessions.peakViewerCount}), 0)`,
        })
        .from(t.liveSessions)
        .where(
          and(
            gte(t.liveSessions.startedAt, window.desde),
            lt(t.liveSessions.startedAt, window.hasta),
          ),
        ),
    ]);

    const sesionesRealizadas = aNumero(sesiones[0]?.count);
    const espectadores = aNumero(sesiones[0]?.espectadores);
    const pedidosEnVivo = enVivo.reduce((total, x) => total + x.count, 0);

    return {
      enVivo,
      fueraDeVivo,
      sesionesRealizadas,
      espectadores,
      conversionBps: espectadores > 0 ? Math.round((pedidosEnVivo / espectadores) * 10_000) : 0,
    };
  }

  async growth(window: MetricsWindow): Promise<GrowthSnapshot> {
    const [usuarios, tiendas, conVentas, conProductos] = await Promise.all([
      this.db
        .select({
          total: sql<string>`count(*)`,
          nuevos: sql<string>`count(*) filter (where ${t.users.createdAt} >= ${window.desde} and ${t.users.createdAt} < ${window.hasta})`,
        })
        .from(t.users),
      this.db
        .select({
          total: sql<string>`count(*)`,
          activas: sql<string>`count(*) filter (where ${t.stores.status} = 'active')`,
          pausadas: sql<string>`count(*) filter (where ${t.stores.status} = 'paused')`,
          suspendidas: sql<string>`count(*) filter (where ${t.stores.status} = 'suspended')`,
          nuevas: sql<string>`count(*) filter (where ${t.stores.createdAt} >= ${window.desde} and ${t.stores.createdAt} < ${window.hasta})`,
        })
        .from(t.stores),
      this.db
        .select({ count: sql<string>`count(distinct ${t.orders.storeId})` })
        .from(t.orders)
        .where(ne(t.orders.status, 'cancelled')),
      this.db
        .select({ count: sql<string>`count(distinct ${t.products.storeId})` })
        .from(t.products),
    ]);

    const tiendasTotal = aNumero(tiendas[0]?.total);
    return {
      usuariosTotal: aNumero(usuarios[0]?.total),
      usuariosNuevos: aNumero(usuarios[0]?.nuevos),
      tiendasTotal,
      tiendasActivas: aNumero(tiendas[0]?.activas),
      tiendasPausadas: aNumero(tiendas[0]?.pausadas),
      tiendasSuspendidas: aNumero(tiendas[0]?.suspendidas),
      tiendasNuevas: aNumero(tiendas[0]?.nuevas),
      tiendasConVentas: aNumero(conVentas[0]?.count),
      // Las que no aparecen en `products`. Se resta en vez de contar con un
      // `left join ... is null` porque el total ya está pedido igual.
      tiendasSinProductos: tiendasTotal - aNumero(conProductos[0]?.count),
    };
  }

  async attention(diasTrabado: number, ahora: Date): Promise<AttentionSnapshot> {
    const corte = new Date(ahora.getTime() - diasTrabado * 86_400_000);

    const [pedidos, disputas, fallidos, negocios, identidades] = await Promise.all([
      this.db
        .select({ status: t.orders.status, count: sql<string>`count(*)` })
        .from(t.orders)
        .groupBy(t.orders.status),
      this.db
        .select({ status: t.disputes.status, count: sql<string>`count(*)` })
        .from(t.disputes)
        .groupBy(t.disputes.status),
      this.db
        .select({ count: sql<string>`count(*)` })
        .from(t.payments)
        .where(and(eq(t.payments.status, 'rejected'), gte(t.payments.createdAt, corte))),
      this.db
        .select({ count: sql<string>`count(*)` })
        .from(t.businessVerifications)
        .where(eq(t.businessVerifications.status, 'pending')),
      this.db
        .select({ count: sql<string>`count(*)` })
        .from(t.identityVerifications)
        .where(eq(t.identityVerifications.status, 'pending')),
    ]);

    const trabados = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(t.orders)
      .where(
        and(
          or(eq(t.orders.status, 'paid'), eq(t.orders.status, 'preparing')),
          lt(t.orders.createdAt, corte),
        ),
      );

    const pedidosPorEstado = contarPor<OrderStatus>(ORDER_STATUSES);
    for (const fila of pedidos) {
      if (fila.status in pedidosPorEstado) {
        pedidosPorEstado[fila.status as OrderStatus] = aNumero(fila.count);
      }
    }
    const disputasPorEstado = contarPor<DisputeStatus>(DISPUTE_STATUSES);
    for (const fila of disputas) {
      if (fila.status in disputasPorEstado) {
        disputasPorEstado[fila.status as DisputeStatus] = aNumero(fila.count);
      }
    }

    return {
      disputasAbiertas: disputasPorEstado.open,
      pedidosTrabados: aNumero(trabados[0]?.count),
      diasTrabado,
      pagosFallidos: aNumero(fallidos[0]?.count),
      verificacionesPendientes: aNumero(negocios[0]?.count) + aNumero(identidades[0]?.count),
      pedidosPorEstado,
      disputasPorEstado,
    };
  }

  async orderRows(window: MetricsWindow): Promise<ReportPage<OrderReportRow>> {
    // Se pide una fila de más para saber si hubo corte sin contar la tabla
    // entera aparte.
    const filas = await this.db
      .select({
        orderId: t.orders.id,
        creadoEn: t.orders.createdAt,
        estado: t.orders.status,
        tienda: t.stores.name,
        compradorNombre: t.users.name,
        compradorEmail: t.users.email,
        currency: t.orders.currency,
        subtotalMinor: t.orders.subtotalMinor,
        shippingMinor: t.orders.shippingMinor,
        discountMinor: t.orders.discountMinor,
        totalMinor: t.orders.totalMinor,
        liveSessionId: t.orders.liveSessionId,
      })
      .from(t.orders)
      .innerJoin(t.stores, eq(t.stores.id, t.orders.storeId))
      .innerJoin(t.users, eq(t.users.id, t.orders.buyerId))
      .where(and(gte(t.orders.createdAt, window.desde), lt(t.orders.createdAt, window.hasta)))
      .orderBy(asc(t.orders.createdAt))
      .limit(LIMITE_REPORTE + 1);

    const truncado = filas.length > LIMITE_REPORTE;
    return {
      truncado,
      filas: filas.slice(0, LIMITE_REPORTE).map((fila) => ({
        orderId: fila.orderId,
        creadoEn: fila.creadoEn,
        estado: fila.estado as OrderStatus,
        tienda: fila.tienda,
        compradorNombre: fila.compradorNombre,
        compradorEmail: fila.compradorEmail,
        currency: fila.currency as CurrencyCode,
        subtotalMinor: fila.subtotalMinor,
        shippingMinor: fila.shippingMinor,
        discountMinor: fila.discountMinor,
        totalMinor: fila.totalMinor,
        desdeVivo: fila.liveSessionId !== null,
      })),
    };
  }

  async paymentRows(window: MetricsWindow): Promise<ReportPage<PaymentReportRow>> {
    const filas = await this.db
      .select({
        paymentId: t.payments.id,
        orderId: t.payments.orderId,
        creadoEn: t.payments.createdAt,
        aprobadoEn: t.payments.approvedAt,
        estado: t.payments.status,
        tienda: t.stores.name,
        currency: t.payments.currency,
        grossMinor: t.payments.grossMinor,
        commissionMinor: t.payments.commissionMinor,
        commissionRateBps: t.payments.commissionRateBps,
        netMinor: t.payments.netMinor,
        proveedor: t.payments.provider,
      })
      .from(t.payments)
      .innerJoin(t.stores, eq(t.stores.id, t.payments.storeId))
      .where(and(gte(t.payments.createdAt, window.desde), lt(t.payments.createdAt, window.hasta)))
      .orderBy(asc(t.payments.createdAt))
      .limit(LIMITE_REPORTE + 1);

    const truncado = filas.length > LIMITE_REPORTE;
    return {
      truncado,
      filas: filas.slice(0, LIMITE_REPORTE).map((fila) => ({
        ...fila,
        estado: fila.estado as PaymentStatus,
        currency: fila.currency as CurrencyCode,
      })),
    };
  }
}
