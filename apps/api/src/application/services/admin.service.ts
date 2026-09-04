import { Inject, Injectable } from '@nestjs/common';
import { getMarket } from '@vivo/config';
import type { AdminOverviewDto } from '@vivo/shared';
import type { Clock } from '../ports/infrastructure';
import {
  METRICS_REPOSITORY,
  type MetricsRepository,
  type MetricsWindow,
  type OrderReportRow,
  type PaymentReportRow,
  type ReportPage,
} from '../ports/metrics';
import { CLOCK } from '../ports/tokens';

/** Cuántos días atrás mira el panel si no se pide otra cosa. */
const DIAS_POR_DEFECTO = 30;
/** El máximo que se acepta. Un año de ventana ya es un reporte, no un tablero. */
const DIAS_MAXIMO = 365;
/**
 * Desde cuántos días un pedido pago y sin despachar cuenta como trabado.
 *
 * Tres días hábiles es lo que una persona tolera antes de escribir preguntando
 * qué pasó. El número es discutible; lo que no es discutible es que exista, y
 * que se muestre junto al total para que se entienda qué se está contando.
 */
const DIAS_TRABADO = 3;

@Injectable()
export class AdminService {
  constructor(
    @Inject(METRICS_REPOSITORY) private readonly metrics: MetricsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async overview(diasPedidos?: number): Promise<AdminOverviewDto> {
    const dias = normalizarDias(diasPedidos);
    const window = this.ventana(dias);

    const [revenue, serie, vivo, crecimiento, atencion] = await Promise.all([
      this.metrics.revenue(window),
      this.metrics.revenueByDay(window),
      this.metrics.liveImpact(window),
      this.metrics.growth(window),
      this.metrics.attention(DIAS_TRABADO, window.hasta),
    ]);

    return {
      desde: window.desde.toISOString(),
      hasta: window.hasta.toISOString(),
      dias,
      timeZone: window.timeZone,
      generadoEn: this.clock.now().toISOString(),
      revenue: {
        aprobado: [...revenue.aprobado],
        reembolsado: [...revenue.reembolsado],
        pendiente: [...revenue.pendiente],
        porEstado: { ...revenue.porEstado },
      },
      serie: [...serie],
      vivo: {
        enVivo: [...vivo.enVivo],
        fueraDeVivo: [...vivo.fueraDeVivo],
        sesionesRealizadas: vivo.sesionesRealizadas,
        espectadores: vivo.espectadores,
        conversionBps: vivo.conversionBps,
      },
      crecimiento: { ...crecimiento },
      atencion: {
        disputasAbiertas: atencion.disputasAbiertas,
        pedidosTrabados: atencion.pedidosTrabados,
        diasTrabado: atencion.diasTrabado,
        pagosFallidos: atencion.pagosFallidos,
        verificacionesPendientes: atencion.verificacionesPendientes,
        pedidosPorEstado: { ...atencion.pedidosPorEstado },
        disputasPorEstado: { ...atencion.disputasPorEstado },
      },
    };
  }

  async reportePedidos(diasPedidos?: number): Promise<string> {
    const page = await this.metrics.orderRows(this.ventana(normalizarDias(diasPedidos)));
    return aCsv(
      [
        'pedido',
        'fecha',
        'estado',
        'tienda',
        'comprador',
        'email',
        'moneda',
        'subtotal',
        'envio',
        'descuento',
        'total',
        'desde_vivo',
      ],
      page.filas.map((fila) => [
        fila.orderId,
        fila.creadoEn.toISOString(),
        fila.estado,
        fila.tienda,
        fila.compradorNombre,
        fila.compradorEmail,
        fila.currency,
        aDecimal(fila.subtotalMinor),
        aDecimal(fila.shippingMinor),
        aDecimal(fila.discountMinor),
        aDecimal(fila.totalMinor),
        fila.desdeVivo ? 'si' : 'no',
      ]),
      page,
    );
  }

  async reporteCobros(diasPedidos?: number): Promise<string> {
    const page = await this.metrics.paymentRows(this.ventana(normalizarDias(diasPedidos)));
    return aCsv(
      [
        'cobro',
        'pedido',
        'creado',
        'aprobado',
        'estado',
        'tienda',
        'moneda',
        'bruto',
        'comision',
        'comision_bps',
        'neto',
        'proveedor',
      ],
      page.filas.map((fila) => [
        fila.paymentId,
        fila.orderId ?? '',
        fila.creadoEn.toISOString(),
        fila.aprobadoEn?.toISOString() ?? '',
        fila.estado,
        fila.tienda,
        fila.currency,
        aDecimal(fila.grossMinor),
        aDecimal(fila.commissionMinor),
        String(fila.commissionRateBps),
        aDecimal(fila.netMinor),
        fila.proveedor,
      ]),
      page,
    );
  }

  private ventana(dias: number): MetricsWindow {
    const hasta = this.clock.now();
    return {
      desde: new Date(hasta.getTime() - dias * 86_400_000),
      hasta,
      timeZone: getMarket('UY').timeZone,
    };
  }
}

function normalizarDias(dias?: number): number {
  if (!dias || !Number.isFinite(dias)) return DIAS_POR_DEFECTO;
  return Math.min(Math.max(Math.trunc(dias), 1), DIAS_MAXIMO);
}

/** Centavos a decimal con punto: `123456` → `1234.56`. */
function aDecimal(minor: number): string {
  const signo = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${signo}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Escapa un campo de CSV según RFC 4180.
 *
 * Lo importante es el primer caso: un nombre de tienda con una coma —"Ropa,
 * calzado y más"— parte la fila en dos columnas y desplaza todo lo que sigue.
 * Con miles de filas eso no se ve; se ve cuando los totales de la planilla no
 * dan y ya nadie se acuerda de por qué.
 */
function campo(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replaceAll('"', '""')}"`;
  return valor;
}

function aCsv(
  cabeceras: readonly string[],
  filas: readonly (readonly string[])[],
  page: ReportPage<OrderReportRow | PaymentReportRow>,
): string {
  const lineas = [cabeceras.join(','), ...filas.map((fila) => fila.map(campo).join(','))];
  if (page.truncado) {
    // Un archivo cortado que no dice que está cortado es peor que uno que
    // falta: quien lo abre suma lo que ve y cree que ese es el total.
    lineas.push('');
    lineas.push(campo('AVISO: se alcanzó el máximo de filas. Pedí una ventana más corta.'));
  }
  // CRLF: es lo que pide el RFC y lo que Excel espera en Windows.
  return `${lineas.join('\r\n')}\r\n`;
}
