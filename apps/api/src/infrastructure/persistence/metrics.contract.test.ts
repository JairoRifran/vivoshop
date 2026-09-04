import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { asPaymentId, type Order, type Payment, type PaymentStatus } from '@vivo/domain';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MetricsRepository, MetricsWindow } from '../../application/ports/metrics';
import type { PaymentRepository } from '../../application/ports/payments';
import type { OrderRepository } from '../../application/ports/repositories';
import type { VivoDatabase } from './drizzle/client';
import { DrizzleMetricsRepository } from './drizzle/drizzle.metrics';
import { DrizzlePaymentRepository } from './drizzle/drizzle.payments';
import { DrizzleOrderRepository } from './drizzle/drizzle.repositories';
import { schema } from './drizzle/schema';
import { seedDatabase } from './drizzle/seed';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryMetricsRepository } from './memory/memory.metrics';
import { MemoryPaymentRepository } from './memory/memory.payments';
import { MemoryOrderRepository } from './memory/memory.repositories';

/**
 * Las cuentas del panel, contra los dos drivers.
 *
 * Lo que se prueba es **paridad**: con los mismos datos, memoria y PostgreSQL
 * tienen que dar exactamente el mismo número. No es una formalidad — las dos
 * implementaciones no se parecen en nada. Una itera colecciones en JavaScript;
 * la otra suma con `sum()`, `count(*) filter (...)` y `group by` en SQL. Cada
 * una puede equivocarse por su lado, y en un tablero de plata un total mal
 * calculado no se nota mirándolo: se nota cuando no cierra con el banco.
 *
 * Los dos casos que esta prueba existe para atrapar:
 *
 * 1. **La zona horaria.** `revenueByDay` agrupa por día. PostgreSQL lo haría en
 *    el huso del servidor —UTC en Railway— y JavaScript en el de quien corre el
 *    proceso. Un cobro de las 21:30 de Montevideo cae al día siguiente en UTC.
 *    Acá hay uno puesto a propósito en esa hora.
 * 2. **Los tipos que devuelve la base.** `sum()` de PostgreSQL vuelve como
 *    texto y como `null` cuando no sumó nada. Sin convertirlo, el panel muestra
 *    `NaN` o concatena en vez de sumar.
 *
 * La comparación de resultados vacíos no probaría nada, así que primero se
 * verifica que los números sean distintos de cero.
 */
const AHORA = new Date('2026-03-15T12:00:00Z');
const VENTANA: MetricsWindow = {
  desde: new Date('2026-03-01T00:00:00Z'),
  hasta: new Date('2026-04-01T00:00:00Z'),
  timeZone: 'America/Montevideo',
};

interface Driver {
  readonly name: string;
  readonly metrics: MetricsRepository;
  readonly payments: PaymentRepository;
  readonly orders: OrderRepository;
  dispose(): Promise<void>;
}

async function memoryDriver(): Promise<Driver> {
  const db = new MemoryDatabase();
  // El hash es de mentira a propósito: acá no se prueba nada de credenciales, y
  // correr scrypt de verdad por cada usuario del dataset agregaría segundos a
  // cada corrida para guardar un valor que ninguna de estas pruebas lee.
  await db.seed(async (plain) => `no-hash:${plain}`, { now: AHORA });
  return {
    name: 'memory',
    metrics: new MemoryMetricsRepository(db),
    payments: new MemoryPaymentRepository(db),
    orders: new MemoryOrderRepository(db),
    dispose: async () => undefined,
  };
}

async function pgliteDriver(): Promise<Driver> {
  const client = new PGlite();
  const folder = resolve(__dirname, '../../../drizzle');
  for (const file of readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(resolve(folder, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.exec(trimmed);
    }
  }

  const db = drizzle(client, { schema }) as unknown as VivoDatabase;
  await seedDatabase(db, { now: AHORA });

  return {
    name: 'postgres (pglite)',
    metrics: new DrizzleMetricsRepository(db),
    payments: new DrizzlePaymentRepository(db),
    orders: new DrizzleOrderRepository(db),
    dispose: async () => client.close(),
  };
}

/** Un cobro completo. Los montos son los que después se verifican sumados. */
function cobro(
  id: string,
  pedido: Order,
  status: PaymentStatus,
  fechas: { creado: Date; aprobado?: Date; reembolsado?: Date },
): Payment {
  const gross = pedido.totalMinor;
  const commission = Math.round(gross * 0.08);
  return {
    id: asPaymentId(id),
    purpose: 'order',
    orderId: pedido.id,
    storeId: pedido.storeId,
    payerId: pedido.buyerId,
    status,
    currency: pedido.currency,
    split: {
      grossMinor: gross,
      commissionMinor: commission,
      commissionRateBps: 800,
      commissionPolicy: 'contract-test',
      netMinor: gross - commission,
    },
    installments: 1,
    provider: 'fake',
    providerIntentId: null,
    providerPaymentId: null,
    checkoutUrl: null,
    failureReason: null,
    expiresAt: null,
    approvedAt: fechas.aprobado ?? null,
    refundedAt: fechas.reembolsado ?? null,
    createdAt: fechas.creado,
    updatedAt: fechas.creado,
  };
}

/**
 * Los mismos cobros en los dos drivers.
 *
 * Van atados a pedidos que el dataset de demostración ya creó, porque en
 * PostgreSQL hay claves foráneas hacia `orders`, `stores` y `users`: inventar
 * identificadores haría fallar la inserción y no probaría nada.
 */
async function sembrarCobros(driver: Driver): Promise<void> {
  const pedidos = [...(await driver.orders.list())].sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  expect(pedidos.length, 'el dataset de demo tiene que traer pedidos').toBeGreaterThanOrEqual(3);
  const [uno, dos, tres] = pedidos as [Order, Order, Order];

  await driver.payments.create(
    cobro('pay-uno', uno, 'approved', {
      creado: new Date('2026-03-10T14:00:00Z'),
      aprobado: new Date('2026-03-10T14:05:00Z'),
    }),
  );
  // 21:30 en Montevideo (UTC-3) es el 11 a las 00:30 UTC. Si alguno de los dos
  // drivers agrupa en UTC, este cobro se le va al día 11 y la serie no coincide.
  await driver.payments.create(
    cobro('pay-borde', dos, 'approved', {
      creado: new Date('2026-03-11T00:20:00Z'),
      aprobado: new Date('2026-03-11T00:30:00Z'),
    }),
  );
  await driver.payments.create(
    cobro('pay-devuelto', tres, 'refunded', {
      creado: new Date('2026-03-05T10:00:00Z'),
      aprobado: new Date('2026-03-05T10:05:00Z'),
      reembolsado: new Date('2026-03-20T09:00:00Z'),
    }),
  );
  // Fuera de la ventana: no tiene que aparecer en ningún total.
  await driver.payments.create(
    cobro('pay-viejo', uno, 'approved', {
      creado: new Date('2026-01-15T10:00:00Z'),
      aprobado: new Date('2026-01-15T10:05:00Z'),
    }),
  );
}

describe('paridad de métricas entre drivers', () => {
  let memoria: Driver;
  let postgres: Driver;

  beforeAll(async () => {
    memoria = await memoryDriver();
    postgres = await pgliteDriver();
    await sembrarCobros(memoria);
    await sembrarCobros(postgres);
  }, 60_000);

  afterAll(async () => {
    await memoria?.dispose();
    await postgres?.dispose();
  });

  it('los ingresos coinciden, y no son cero', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.revenue(VENTANA),
      postgres.metrics.revenue(VENTANA),
    ]);

    // Sin esto, dos resultados vacíos "coincidirían" y la prueba pasaría
    // sin haber ejercitado ninguna suma.
    expect(a.aprobado.length).toBeGreaterThan(0);
    expect(a.aprobado[0]?.grossMinor).toBeGreaterThan(0);
    expect(a.aprobado[0]?.commissionMinor).toBeGreaterThan(0);
    expect(a.reembolsado[0]?.grossMinor).toBeGreaterThan(0);

    expect(b).toEqual(a);
  });

  it('los totales son números, no el texto que devuelve sum()', async () => {
    const { aprobado } = await postgres.metrics.revenue(VENTANA);
    for (const total of aprobado) {
      expect(typeof total.grossMinor).toBe('number');
      expect(typeof total.commissionMinor).toBe('number');
      expect(Number.isFinite(total.grossMinor)).toBe(true);
    }
  });

  it('la comisión nunca supera lo cobrado', async () => {
    const { aprobado } = await memoria.metrics.revenue(VENTANA);
    for (const total of aprobado) {
      expect(total.commissionMinor).toBeLessThanOrEqual(total.grossMinor);
      expect(total.commissionMinor + total.netMinor).toBe(total.grossMinor);
    }
  });

  it('lo de fuera de la ventana queda afuera en los dos', async () => {
    const vacia: MetricsWindow = {
      desde: new Date('2025-01-01T00:00:00Z'),
      hasta: new Date('2025-02-01T00:00:00Z'),
      timeZone: 'America/Montevideo',
    };
    const [a, b] = await Promise.all([
      memoria.metrics.revenue(vacia),
      postgres.metrics.revenue(vacia),
    ]);
    expect(a.aprobado).toEqual([]);
    expect(b.aprobado).toEqual([]);
  });

  it('la serie diaria coincide, incluido el cobro de las 21:30 de Montevideo', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.revenueByDay(VENTANA),
      postgres.metrics.revenueByDay(VENTANA),
    ]);

    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);

    // El cobro de las 00:30 UTC del 11 es del 10 en Montevideo. Que los dos
    // drivers coincidan no alcanza: podrían coincidir los dos en UTC.
    const dias = a.map((punto) => punto.dia);
    expect(dias).toContain('2026-03-10');
    expect(dias).not.toContain('2026-03-11');
  });

  it('el impacto del vivo coincide', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.liveImpact(VENTANA),
      postgres.metrics.liveImpact(VENTANA),
    ]);
    expect(b).toEqual(a);
  });

  it('el crecimiento coincide, y cuenta cosas que existen', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.growth(VENTANA),
      postgres.metrics.growth(VENTANA),
    ]);
    expect(a.usuariosTotal).toBeGreaterThan(0);
    expect(a.tiendasTotal).toBeGreaterThan(0);
    expect(a.tiendasSinProductos).toBeGreaterThanOrEqual(0);
    expect(b).toEqual(a);
  });

  it('lo que hay que atender coincide', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.attention(3, AHORA),
      postgres.metrics.attention(3, AHORA),
    ]);
    const totalPedidos = Object.values(a.pedidosPorEstado).reduce((s, n) => s + n, 0);
    expect(totalPedidos).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('las filas del reporte coinciden', async () => {
    const [a, b] = await Promise.all([
      memoria.metrics.orderRows(VENTANA),
      postgres.metrics.orderRows(VENTANA),
    ]);
    expect(a.truncado).toBe(false);
    expect(b.filas.map((f) => f.orderId)).toEqual(a.filas.map((f) => f.orderId));

    const [pa, pb] = await Promise.all([
      memoria.metrics.paymentRows(VENTANA),
      postgres.metrics.paymentRows(VENTANA),
    ]);
    expect(pa.filas.length).toBeGreaterThan(0);
    expect(pb.filas.map((f) => f.paymentId)).toEqual(pa.filas.map((f) => f.paymentId));
    expect(pb.filas.map((f) => f.commissionMinor)).toEqual(pa.filas.map((f) => f.commissionMinor));
  });
});
