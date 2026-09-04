/**
 * Las cuentas de la plataforma, para el panel del dueño.
 *
 * ## Por qué es un puerto propio y no `orders.list()` + sumar en TypeScript
 *
 * Porque `list()` trunca. `DrizzleOrderRepository.list` corta en 100 filas por
 * defecto y `DrizzlePaymentRepository.listByStore` también acepta un límite: un
 * tablero que sumara sobre eso mostraría un número más chico que el real **sin
 * avisar**, y un total de plata equivocado es peor que no tener el total. Este
 * puerto devuelve agregados ya calculados —la base los hace con `sum`/`count`,
 * la memoria iterando— y nunca una lista que alguien pueda sumar por error.
 *
 * La excepción es la exportación a CSV, que sí necesita filas. Ahí el corte es
 * explícito: `LIMITE_REPORTE` y una bandera `truncado` que la pantalla muestra.
 *
 * ## Por qué todo va agrupado por moneda
 *
 * Sumar UYU con cualquier otra cosa da un número que no significa nada. Hoy
 * todas las tiendas son uruguayas y el resultado va a traer una sola fila, pero
 * `@vivo/config` ya tiene varios mercados definidos: el día que entre el
 * segundo país, esto sigue estando bien en vez de empezar a mentir en silencio.
 *
 * ## Ventanas
 *
 * `[desde, hasta)` — cerrada por izquierda, abierta por derecha. Así dos
 * ventanas consecutivas no se pisan y una fila no se cuenta dos veces.
 */
import type { CurrencyCode } from '@vivo/config';
import type { DisputeStatus, OrderStatus, PaymentStatus } from '@vivo/domain';

export const METRICS_REPOSITORY = Symbol('MetricsRepository');

/** Tope de filas de una exportación. Ver `ReportPage.truncado`. */
export const LIMITE_REPORTE = 50_000;

export interface MetricsWindow {
  readonly desde: Date;
  /** Exclusivo. */
  readonly hasta: Date;
  /**
   * En qué zona horaria empieza y termina un día. Sale del mercado
   * (`America/Montevideo` para Uruguay).
   *
   * No es un detalle: sin esto, la base agrupa por el huso del servidor —UTC en
   * Railway— y la aplicación por el de quien mira. Una venta de las 21:30 de
   * Montevideo cae al día siguiente en UTC, así que los dos drivers darían
   * series distintas para los mismos datos y la prueba de contrato fallaría
   * sin que ninguno de los dos esté "mal". Fijarla acá hace que el día sea el
   * mismo día en todos lados: el del negocio.
   */
  readonly timeZone: string;
}

/** Totales de una moneda. Nunca se suman entre sí. */
export interface CurrencyTotals {
  readonly currency: CurrencyCode;
  /** Lo que pagaron los compradores. */
  readonly grossMinor: number;
  /** Lo que gana VivoShop. Es la comisión congelada en el cobro. */
  readonly commissionMinor: number;
  /** Lo que le queda al vendedor. */
  readonly netMinor: number;
  readonly count: number;
}

export interface RevenueSnapshot {
  /** Cobros aprobados en la ventana. Es el ingreso real. */
  readonly aprobado: readonly CurrencyTotals[];
  /**
   * Reembolsados, por fecha de reembolso.
   *
   * No se restan de `aprobado` acá: son dos hechos distintos y restarlos
   * escondería cuánto se está devolviendo, que es justo lo que hay que mirar.
   */
  readonly reembolsado: readonly CurrencyTotals[];
  /** Cobros todavía sin resolver, creados en la ventana. */
  readonly pendiente: readonly CurrencyTotals[];
  readonly porEstado: Readonly<Record<PaymentStatus, number>>;
  /*
   * Acá iba "sin liquidar": lo aprobado que el proveedor todavía no liberó.
   *
   * No está porque no se puede calcular. `payments.settlement_status` existe
   * como columna pero la aplicación nunca la escribe —queda en
   * `'not_supported'` para todas las filas—, así que la métrica daría siempre
   * cero y parecería un dato. Cuando alguien conecte la liquidación de verdad,
   * este es el lugar.
   */
}

/** Un día de la serie, para el gráfico. `dia` es `YYYY-MM-DD` en hora local. */
export interface DailyPoint {
  readonly dia: string;
  readonly currency: CurrencyCode;
  readonly grossMinor: number;
  readonly commissionMinor: number;
  readonly count: number;
}

/**
 * Lo que decide si este producto tiene sentido.
 *
 * Un pedido tiene `liveSessionId` cuando salió de una transmisión. Si la plata
 * que entra por vivo no crece contra la que entra por catálogo, VivoShop es una
 * tienda con video, no un producto de venta en vivo.
 */
export interface LiveImpact {
  readonly enVivo: readonly CurrencyTotals[];
  readonly fueraDeVivo: readonly CurrencyTotals[];
  readonly sesionesRealizadas: number;
  /** Suma de espectadores registrados en las sesiones de la ventana. */
  readonly espectadores: number;
  /** Pedidos por cada 10.000 espectadores. 0 si nadie miró. */
  readonly conversionBps: number;
}

export interface GrowthSnapshot {
  readonly usuariosTotal: number;
  readonly usuariosNuevos: number;
  readonly tiendasTotal: number;
  readonly tiendasActivas: number;
  readonly tiendasPausadas: number;
  readonly tiendasSuspendidas: number;
  readonly tiendasNuevas: number;
  /** Tiendas con al menos un pedido no cancelado. El resto figura y no vende. */
  readonly tiendasConVentas: number;
  /** Tiendas sin un solo producto publicado. */
  readonly tiendasSinProductos: number;
}

/** Cosas que requieren que el dueño haga algo. */
export interface AttentionSnapshot {
  readonly disputasAbiertas: number;
  /**
   * Pagados hace más de `diasTrabado` y todavía sin despachar.
   *
   * Del otro lado hay alguien que pagó y no recibió nada: es el número que más
   * rápido se convierte en un reclamo.
   */
  readonly pedidosTrabados: number;
  readonly diasTrabado: number;
  readonly pagosFallidos: number;
  readonly verificacionesPendientes: number;
  readonly pedidosPorEstado: Readonly<Record<OrderStatus, number>>;
  readonly disputasPorEstado: Readonly<Record<DisputeStatus, number>>;
}

/** Una fila de la exportación de pedidos. Ya desnormalizada para el CSV. */
export interface OrderReportRow {
  readonly orderId: string;
  readonly creadoEn: Date;
  readonly estado: OrderStatus;
  readonly tienda: string;
  readonly compradorNombre: string;
  readonly compradorEmail: string;
  readonly currency: CurrencyCode;
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly desdeVivo: boolean;
}

/** Una fila de la exportación de cobros. Es la que sirve para contabilidad. */
export interface PaymentReportRow {
  readonly paymentId: string;
  readonly orderId: string | null;
  readonly creadoEn: Date;
  readonly aprobadoEn: Date | null;
  readonly estado: PaymentStatus;
  readonly tienda: string;
  readonly currency: CurrencyCode;
  readonly grossMinor: number;
  readonly commissionMinor: number;
  readonly commissionRateBps: number;
  readonly netMinor: number;
  readonly proveedor: string;
}

export interface ReportPage<T> {
  readonly filas: readonly T[];
  /** `true` si se alcanzó `LIMITE_REPORTE` y quedaron filas afuera. */
  readonly truncado: boolean;
}

export interface MetricsRepository {
  revenue(window: MetricsWindow): Promise<RevenueSnapshot>;
  /** Serie diaria de cobros aprobados, para el gráfico. */
  revenueByDay(window: MetricsWindow): Promise<readonly DailyPoint[]>;
  liveImpact(window: MetricsWindow): Promise<LiveImpact>;
  growth(window: MetricsWindow): Promise<GrowthSnapshot>;
  attention(diasTrabado: number, ahora: Date): Promise<AttentionSnapshot>;
  orderRows(window: MetricsWindow): Promise<ReportPage<OrderReportRow>>;
  paymentRows(window: MetricsWindow): Promise<ReportPage<PaymentReportRow>>;
}
