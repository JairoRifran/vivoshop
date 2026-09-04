import { z } from 'zod';
import { currencySchema } from './primitives';

/**
 * Lo que ve el dueño de la plataforma. Ninguna de estas formas sale de acá
 * hacia una pantalla pública.
 *
 * Los montos son enteros en la unidad mínima de la moneda (centavos), como en
 * todo el resto del sistema: un `number` con decimales para plata termina en
 * 0.1 + 0.2 = 0.30000000000000004, y en un tablero de comisiones eso se
 * acumula.
 */
export const currencyTotalsSchema = z.object({
  currency: currencySchema,
  grossMinor: z.number().int(),
  commissionMinor: z.number().int(),
  netMinor: z.number().int(),
  count: z.number().int(),
});
export type CurrencyTotalsDto = z.infer<typeof currencyTotalsSchema>;

export const dailyPointSchema = z.object({
  dia: z.string(),
  currency: currencySchema,
  grossMinor: z.number().int(),
  commissionMinor: z.number().int(),
  count: z.number().int(),
});
export type DailyPointDto = z.infer<typeof dailyPointSchema>;

export const adminOverviewSchema = z.object({
  /** La ventana que se pidió, devuelta para que la pantalla no la adivine. */
  desde: z.string(),
  hasta: z.string(),
  dias: z.number().int(),
  timeZone: z.string(),
  /** Cuándo se calculó. El panel no cachea, pero conviene poder verlo. */
  generadoEn: z.string(),

  revenue: z.object({
    aprobado: z.array(currencyTotalsSchema),
    reembolsado: z.array(currencyTotalsSchema),
    pendiente: z.array(currencyTotalsSchema),
    porEstado: z.record(z.string(), z.number().int()),
  }),
  serie: z.array(dailyPointSchema),

  vivo: z.object({
    enVivo: z.array(currencyTotalsSchema),
    fueraDeVivo: z.array(currencyTotalsSchema),
    sesionesRealizadas: z.number().int(),
    espectadores: z.number().int(),
    conversionBps: z.number().int(),
  }),

  crecimiento: z.object({
    usuariosTotal: z.number().int(),
    usuariosNuevos: z.number().int(),
    tiendasTotal: z.number().int(),
    tiendasActivas: z.number().int(),
    tiendasPausadas: z.number().int(),
    tiendasSuspendidas: z.number().int(),
    tiendasNuevas: z.number().int(),
    tiendasConVentas: z.number().int(),
    tiendasSinProductos: z.number().int(),
  }),

  atencion: z.object({
    disputasAbiertas: z.number().int(),
    pedidosTrabados: z.number().int(),
    diasTrabado: z.number().int(),
    pagosFallidos: z.number().int(),
    verificacionesPendientes: z.number().int(),
    /** Denuncias de contenido sin resolver (M14). */
    denunciasAbiertas: z.number().int(),
    pedidosPorEstado: z.record(z.string(), z.number().int()),
    disputasPorEstado: z.record(z.string(), z.number().int()),
  }),
});
export type AdminOverviewDto = z.infer<typeof adminOverviewSchema>;
