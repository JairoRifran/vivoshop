import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { asLiveSessionId, asUserId } from '@vivo/domain';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VivoDatabase } from './drizzle/client';
import { DrizzlePushDeliveryRepository, DrizzlePushSubscriptionRepository } from './drizzle/drizzle.repositories';
import { schema } from './drizzle/schema';
import { seedDatabase } from './drizzle/seed';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryPushDeliveryRepository, MemoryPushSubscriptionRepository } from './memory/memory.repositories';
import type { PushDeliveryRepository, PushSubscriptionRepository } from '../../application/ports/repositories';

/**
 * La reserva de envíos, contra los dos drivers.
 *
 * Lo que se prueba es la única propiedad que importa: **reservar dos veces el
 * mismo destino devuelve el destino una sola vez**. De ahí sale la garantía de
 * "un aviso por vivo y por dispositivo", y tiene que valer igual en memoria y
 * en PostgreSQL — si algún día dependiera solo del `on conflict do nothing`,
 * el driver en memoria lo diría acá.
 *
 * La carrera se prueba de verdad, con reservas concurrentes, y no simulando el
 * resultado: en PostgreSQL es la restricción de clave primaria la que decide, y
 * eso es exactamente lo que hay que ejercitar.
 */
const NOW = new Date('2026-08-27T12:00:00Z');
const LIVE = asLiveSessionId('live-plaza-otono');
const USER = asUserId('ana');

interface Driver {
  readonly name: string;
  readonly deliveries: PushDeliveryRepository;
  readonly subscriptions: PushSubscriptionRepository;
  dispose(): Promise<void>;
}

async function memoryDriver(): Promise<Driver> {
  const db = new MemoryDatabase();
  return {
    name: 'memory',
    deliveries: new MemoryPushDeliveryRepository(db),
    subscriptions: new MemoryPushSubscriptionRepository(db),
    dispose: async () => undefined,
  };
}

async function pgliteDriver(): Promise<Driver> {
  const client = new PGlite();
  const folder = resolve(__dirname, '../../../drizzle');
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(folder, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.exec(trimmed);
    }
  }

  const db = drizzle(client, { schema }) as unknown as VivoDatabase;
  await seedDatabase(db, { now: NOW });

  return {
    name: 'postgres (pglite)',
    deliveries: new DrizzlePushDeliveryRepository(db),
    subscriptions: new DrizzlePushSubscriptionRepository(db),
    dispose: async () => client.close(),
  };
}

for (const create of [memoryDriver, pgliteDriver]) {
  describe(`reserva de envíos — ${create.name === 'memoryDriver' ? 'memory' : 'postgres (pglite)'}`, () => {
    let driver: Driver;

    beforeEach(async () => {
      await driver?.dispose();
      driver = await create();

      // La constancia referencia una suscripción real: en PostgreSQL hay una
      // clave foránea, y probar contra endpoints inventados no probaría nada.
      for (const endpoint of ['https://push.uy/telefono', 'https://push.uy/tablet']) {
        await driver.subscriptions.save({
          endpoint,
          userId: USER,
          p256dh: 'clave',
          auth: 'secreto',
          userAgent: null,
          createdAt: NOW,
          lastNotifiedAt: null,
        });
      }
    });

    afterAll(async () => {
      await driver?.dispose();
    });

    const endpoints = ['https://push.uy/telefono', 'https://push.uy/tablet'];
    const reserve = (which = endpoints) =>
      driver.deliveries.reserve({
        liveSessionId: LIVE,
        endpoints: which,
        type: 'live_started',
        at: NOW,
      });

    it('la primera reserva se queda con todos los destinos', async () => {
      expect((await reserve()).sort()).toEqual([...endpoints].sort());
      expect(await driver.deliveries.countFor(LIVE, 'live_started')).toBe(2);
    });

    it('reservar de nuevo no devuelve ninguno', async () => {
      await reserve();
      expect(await reserve()).toEqual([]);
      // Y no aparecen filas nuevas: reintentar no infla nada.
      expect(await driver.deliveries.countFor(LIVE, 'live_started')).toBe(2);
    });

    it('un dispositivo nuevo se reserva aunque el resto ya esté', async () => {
      await reserve(['https://push.uy/telefono']);

      // Alguien acepta el permiso en la tablet mientras el vivo ya empezó.
      expect(await reserve()).toEqual(['https://push.uy/tablet']);
      expect(await driver.deliveries.countFor(LIVE, 'live_started')).toBe(2);
    });

    it('cinco reservas concurrentes reparten cada destino una sola vez', async () => {
      /**
       * La carrera de varias réplicas anunciando el mismo vivo.
       *
       * Si la exclusión dependiera de leer antes de escribir, las cinco verían
       * "no hay entrega" y las cinco enviarían. Lo que lo impide es que
       * reservar sea un insert: la base decide quién gana cada destino.
       */
      const results = await Promise.all(Array.from({ length: 5 }, () => reserve()));

      const claimed = results.flat().sort();
      expect(claimed).toEqual([...endpoints].sort());
      expect(await driver.deliveries.countFor(LIVE, 'live_started')).toBe(2);
    });

    it('otro vivo se reserva por su cuenta', async () => {
      // La constancia es por vivo: terminar uno y empezar otro vuelve a avisar.
      await reserve();
      // Un vivo real del conjunto sembrado: en PostgreSQL hay clave foránea, y
      // un id inventado probaría que la restricción existe, no que la reserva
      // funciona.
      const otro = asLiveSessionId('live-plaza-anterior');

      const claimed = await driver.deliveries.reserve({
        liveSessionId: otro,
        endpoints,
        type: 'live_started',
        at: NOW,
      });
      expect(claimed.sort()).toEqual([...endpoints].sort());
    });

    it('sin destinos no toca nada', async () => {
      expect(await reserve([])).toEqual([]);
      expect(await driver.deliveries.countFor(LIVE, 'live_started')).toBe(0);
    });
  });
}
