import { Injectable } from '@nestjs/common';
import type { CurrencyCode } from '@vivo/config';
import {
  DISPUTE_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type DisputeStatus,
  type Order,
  type OrderStatus,
  type Payment,
  type PaymentStatus,
} from '@vivo/domain';
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
import { MemoryDatabase } from './memory-database';

/** Suma acumulable por moneda. Se vuelca a `CurrencyTotals[]` al final. */
interface Acumulador {
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
  count: number;
}

function acumular(
  mapa: Map<CurrencyCode, Acumulador>,
  currency: CurrencyCode,
  pago: Payment,
): void {
  const actual = mapa.get(currency) ?? { grossMinor: 0, commissionMinor: 0, netMinor: 0, count: 0 };
  actual.grossMinor += pago.split.grossMinor;
  actual.commissionMinor += pago.split.commissionMinor;
  actual.netMinor += pago.split.netMinor;
  actual.count += 1;
  mapa.set(currency, actual);
}

/**
 * Ordenado por moneda para que el resultado sea estable.
 *
 * La prueba de contrato compara los dos drivers fila por fila, y un `Map` de
 * JavaScript conserva el orden de inserción mientras que un `group by` de
 * Postgres no promete ninguno. Sin ordenar, la prueba pasaría o fallaría según
 * en qué orden se hayan cargado los datos.
 */
function volcar(mapa: Map<CurrencyCode, Acumulador>): CurrencyTotals[] {
  return [...mapa.entries()]
    .map(([currency, total]) => ({ currency, ...total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function enVentana(fecha: Date | null, window: MetricsWindow): boolean {
  if (!fecha) return false;
  return fecha >= window.desde && fecha < window.hasta;
}

/**
 * `YYYY-MM-DD` en la zona del mercado, no en la del servidor.
 *
 * `en-CA` porque su formato corto ya es `YYYY-MM-DD`; armarlo a mano con
 * `getFullYear()` daría el día del huso donde corre Node, que en Railway es
 * UTC. Ver la nota de `timeZone` en el puerto.
 */
function diaLocal(fecha: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

function contarPor<T extends string>(claves: readonly T[]): Record<T, number> {
  return Object.fromEntries(claves.map((clave) => [clave, 0])) as Record<T, number>;
}

/**
 * Las métricas sobre el driver de memoria.
 *
 * Recorre las colecciones enteras en cada llamada. Es O(n) sobre todo lo que
 * hay en el proceso y está bien: este driver existe para desarrollo y pruebas,
 * donde `n` son unas decenas de filas. El que corre contra datos de verdad es
 * el de Drizzle, que agrega en la base.
 */
@Injectable()
export class MemoryMetricsRepository implements MetricsRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async revenue(window: MetricsWindow): Promise<RevenueSnapshot> {
    const aprobado = new Map<CurrencyCode, Acumulador>();
    const reembolsado = new Map<CurrencyCode, Acumulador>();
    const pendiente = new Map<CurrencyCode, Acumulador>();
    const porEstado = contarPor<PaymentStatus>(PAYMENT_STATUSES);

    for (const pago of this.db.payments.values()) {
      // Cada eje se cuenta por su propia fecha: aprobado por cuándo se aprobó,
      // reembolsado por cuándo se devolvió. Un cobro aprobado en marzo y
      // devuelto en abril pertenece a marzo en un eje y a abril en el otro.
      if (pago.status === 'approved' && enVentana(pago.approvedAt, window)) {
        acumular(aprobado, pago.currency, pago);
      }
      if (pago.status === 'refunded' && enVentana(pago.refundedAt, window)) {
        acumular(reembolsado, pago.currency, pago);
      }
      if (pago.status === 'pending' && enVentana(pago.createdAt, window)) {
        acumular(pendiente, pago.currency, pago);
      }
      if (enVentana(pago.createdAt, window)) porEstado[pago.status] += 1;
    }

    return {
      aprobado: volcar(aprobado),
      reembolsado: volcar(reembolsado),
      pendiente: volcar(pendiente),
      porEstado,
    };
  }

  async revenueByDay(window: MetricsWindow): Promise<readonly DailyPoint[]> {
    const porDia = new Map<string, Acumulador & { dia: string; currency: CurrencyCode }>();

    for (const pago of this.db.payments.values()) {
      if (pago.status !== 'approved' || !enVentana(pago.approvedAt, window)) continue;
      const dia = diaLocal(pago.approvedAt as Date, window.timeZone);
      const clave = `${dia}|${pago.currency}`;
      const actual = porDia.get(clave) ?? {
        dia,
        currency: pago.currency,
        grossMinor: 0,
        commissionMinor: 0,
        netMinor: 0,
        count: 0,
      };
      actual.grossMinor += pago.split.grossMinor;
      actual.commissionMinor += pago.split.commissionMinor;
      actual.count += 1;
      porDia.set(clave, actual);
    }

    return [...porDia.values()]
      .map(({ dia, currency, grossMinor, commissionMinor, count }) => ({
        dia,
        currency,
        grossMinor,
        commissionMinor,
        count,
      }))
      .sort((a, b) => a.dia.localeCompare(b.dia) || a.currency.localeCompare(b.currency));
  }

  async liveImpact(window: MetricsWindow): Promise<LiveImpact> {
    const enVivo = new Map<CurrencyCode, Acumulador>();
    const fuera = new Map<CurrencyCode, Acumulador>();

    for (const pedido of this.db.orders.values()) {
      if (!enVentana(pedido.createdAt, window)) continue;
      // Un pedido cancelado no es venta. Contarlo inflaría los dos lados y,
      // peor, el de vivo más que el otro si un vivo generó compras impulsivas.
      if (pedido.status === 'cancelled') continue;
      const destino = pedido.liveSessionId ? enVivo : fuera;
      const actual = destino.get(pedido.currency) ?? {
        grossMinor: 0,
        commissionMinor: 0,
        netMinor: 0,
        count: 0,
      };
      actual.grossMinor += pedido.totalMinor;
      actual.count += 1;
      destino.set(pedido.currency, actual);
    }

    let sesionesRealizadas = 0;
    let espectadores = 0;
    for (const sesion of this.db.liveSessions.values()) {
      if (!enVentana(sesion.startedAt, window)) continue;
      sesionesRealizadas += 1;
      espectadores += sesion.peakViewerCount;
    }

    const pedidosEnVivo = [...enVivo.values()].reduce((total, x) => total + x.count, 0);
    const conversionBps =
      espectadores > 0 ? Math.round((pedidosEnVivo / espectadores) * 10_000) : 0;

    return {
      enVivo: volcar(enVivo),
      fueraDeVivo: volcar(fuera),
      sesionesRealizadas,
      espectadores,
      conversionBps,
    };
  }

  async growth(window: MetricsWindow): Promise<GrowthSnapshot> {
    const usuarios = [...this.db.users.values()];
    const tiendas = [...this.db.stores.values()];

    const conVentas = new Set<string>();
    for (const pedido of this.db.orders.values()) {
      if (pedido.status !== 'cancelled') conVentas.add(pedido.storeId);
    }
    const conProductos = new Set<string>();
    for (const producto of this.db.products.values()) conProductos.add(producto.storeId);

    return {
      usuariosTotal: usuarios.length,
      usuariosNuevos: usuarios.filter((u) => enVentana(u.createdAt, window)).length,
      tiendasTotal: tiendas.length,
      tiendasActivas: tiendas.filter((s) => s.status === 'active').length,
      tiendasPausadas: tiendas.filter((s) => s.status === 'paused').length,
      tiendasSuspendidas: tiendas.filter((s) => s.status === 'suspended').length,
      tiendasNuevas: tiendas.filter((s) => enVentana(s.createdAt, window)).length,
      tiendasConVentas: tiendas.filter((s) => conVentas.has(s.id)).length,
      tiendasSinProductos: tiendas.filter((s) => !conProductos.has(s.id)).length,
    };
  }

  async attention(diasTrabado: number, ahora: Date): Promise<AttentionSnapshot> {
    const corte = new Date(ahora.getTime() - diasTrabado * 86_400_000);

    const pedidosPorEstado = contarPor<OrderStatus>(ORDER_STATUSES);
    let pedidosTrabados = 0;
    for (const pedido of this.db.orders.values()) {
      pedidosPorEstado[pedido.status] += 1;
      if ((pedido.status === 'paid' || pedido.status === 'preparing') && pedido.createdAt < corte) {
        pedidosTrabados += 1;
      }
    }

    const disputasPorEstado = contarPor<DisputeStatus>(DISPUTE_STATUSES);
    for (const disputa of this.db.disputes.values()) disputasPorEstado[disputa.status] += 1;

    let pagosFallidos = 0;
    for (const pago of this.db.payments.values()) {
      if (pago.status === 'rejected' && pago.createdAt >= corte) pagosFallidos += 1;
    }

    let verificacionesPendientes = 0;
    for (const v of this.db.businessVerifications.values()) {
      if (v.status === 'pending') verificacionesPendientes += 1;
    }
    for (const v of this.db.identityVerifications.values()) {
      if (v.status === 'pending') verificacionesPendientes += 1;
    }

    return {
      disputasAbiertas: disputasPorEstado.open,
      pedidosTrabados,
      diasTrabado,
      pagosFallidos,
      verificacionesPendientes,
      pedidosPorEstado,
      disputasPorEstado,
    };
  }

  async orderRows(window: MetricsWindow): Promise<ReportPage<OrderReportRow>> {
    const pedidos = [...this.db.orders.values()]
      .filter((pedido) => enVentana(pedido.createdAt, window))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const filas = pedidos.slice(0, LIMITE_REPORTE).map((pedido) => this.filaDePedido(pedido));
    return { filas, truncado: pedidos.length > LIMITE_REPORTE };
  }

  async paymentRows(window: MetricsWindow): Promise<ReportPage<PaymentReportRow>> {
    const pagos = [...this.db.payments.values()]
      .filter((pago) => enVentana(pago.createdAt, window))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const filas = pagos.slice(0, LIMITE_REPORTE).map((pago) => ({
      paymentId: String(pago.id),
      orderId: pago.orderId ? String(pago.orderId) : null,
      creadoEn: pago.createdAt,
      aprobadoEn: pago.approvedAt,
      estado: pago.status,
      tienda: this.db.stores.get(String(pago.storeId))?.name ?? '(tienda borrada)',
      currency: pago.currency,
      grossMinor: pago.split.grossMinor,
      commissionMinor: pago.split.commissionMinor,
      commissionRateBps: pago.split.commissionRateBps,
      netMinor: pago.split.netMinor,
      proveedor: pago.provider,
    }));
    return { filas, truncado: pagos.length > LIMITE_REPORTE };
  }

  private filaDePedido(pedido: Order): OrderReportRow {
    const comprador = this.db.users.get(String(pedido.buyerId));
    return {
      orderId: String(pedido.id),
      creadoEn: pedido.createdAt,
      estado: pedido.status,
      tienda: this.db.stores.get(String(pedido.storeId))?.name ?? '(tienda borrada)',
      compradorNombre: comprador?.name ?? '(cuenta borrada)',
      compradorEmail: comprador?.email ?? '',
      currency: pedido.currency,
      subtotalMinor: pedido.subtotalMinor,
      shippingMinor: pedido.shippingMinor,
      discountMinor: pedido.discountMinor,
      totalMinor: pedido.totalMinor,
      desdeVivo: pedido.liveSessionId !== null,
    };
  }
}
