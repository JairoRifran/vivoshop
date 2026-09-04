import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { asUserId, type Report, type UserId } from '@vivo/domain';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationRepository } from '../../application/ports/moderation';
import type { VivoDatabase } from './drizzle/client';
import { DrizzleModerationRepository } from './drizzle/drizzle.moderation';
import { schema } from './drizzle/schema';
import { seedDatabase } from './drizzle/seed';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryModerationRepository } from './memory/memory.moderation';

/**
 * Denunciar y bloquear, contra los dos drivers.
 *
 * Las dos propiedades que esta prueba existe para fijar:
 *
 * 1. **Bloquear es idempotente.** El botón se puede tocar dos veces —conexión
 *    lenta, doble clic— y tiene que quedar un solo bloqueo, con la fecha del
 *    primero. En PostgreSQL lo garantiza la clave primaria compuesta con
 *    `on conflict do nothing`; en memoria, un `if` sobre el `Map`. Son dos
 *    mecanismos distintos y cada uno puede fallar por su lado.
 * 2. **La cola sale de lo más viejo a lo más nuevo.** Una cola de moderación se
 *    atiende por orden de llegada; si un driver la devolviera al revés, lo
 *    primero que se atendería sería lo último que entró, y las denuncias viejas
 *    no se verían nunca.
 */
const AHORA = new Date('2026-09-04T12:00:00Z');
const ANA = asUserId('ana');
const MARTINA = asUserId('martina');
const LUCIA = asUserId('lucia');

interface Driver {
  readonly name: string;
  readonly repo: ModerationRepository;
  dispose(): Promise<void>;
}

async function memoryDriver(): Promise<Driver> {
  const db = new MemoryDatabase();
  await db.seed(async (plain) => `no-hash:${plain}`, { now: AHORA });
  return {
    name: 'memory',
    repo: new MemoryModerationRepository(db),
    dispose: async () => undefined,
  };
}

async function pgliteDriver(): Promise<Driver> {
  const client = new PGlite();
  const folder = resolve(__dirname, '../../../drizzle');
  for (const file of readdirSync(folder)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(resolve(folder, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await client.exec(trimmed);
    }
  }
  const db = drizzle(client, { schema }) as unknown as VivoDatabase;
  // Las denuncias y los bloqueos tienen clave foránea hacia `users`: sin el
  // dataset sembrado, insertar con identificadores inventados falla.
  await seedDatabase(db, { now: AHORA });
  return {
    name: 'postgres (pglite)',
    repo: new DrizzleModerationRepository(db),
    dispose: async () => client.close(),
  };
}

function denuncia(id: string, reporterId: UserId, creadoEn: Date): Report {
  return {
    id,
    reporterId,
    target: 'live_message',
    targetId: `msg-${id}`,
    reason: 'ofensivo',
    detail: 'Insultos en el chat',
    status: 'open',
    createdAt: creadoEn,
    resolvedAt: null,
    resolvedBy: null,
  };
}

for (const crear of [memoryDriver, pgliteDriver]) {
  describe(`moderación — ${crear === memoryDriver ? 'memory' : 'postgres (pglite)'}`, () => {
    let driver: Driver;

    beforeEach(async () => {
      driver = await crear();
    }, 60_000);

    afterEach(async () => {
      await driver?.dispose();
    });

    it('bloquear dos veces deja un solo bloqueo, con la fecha del primero', async () => {
      const primera = new Date('2026-09-04T10:00:00Z');
      const segunda = new Date('2026-09-04T11:00:00Z');

      await driver.repo.block({ blockerId: ANA, blockedId: MARTINA, createdAt: primera });
      await driver.repo.block({ blockerId: ANA, blockedId: MARTINA, createdAt: segunda });

      const bloqueos = await driver.repo.listBlocks(ANA);
      expect(bloqueos).toHaveLength(1);
      expect(bloqueos[0]?.createdAt.toISOString()).toBe(primera.toISOString());
    });

    it('el bloqueo es de ida: que Ana bloquee a Martina no bloquea al revés', async () => {
      await driver.repo.block({ blockerId: ANA, blockedId: MARTINA, createdAt: AHORA });
      expect(await driver.repo.listBlockedIds(ANA)).toEqual(['martina']);
      expect(await driver.repo.listBlockedIds(MARTINA)).toEqual([]);
    });

    it('desbloquear saca solo a esa persona', async () => {
      await driver.repo.block({ blockerId: ANA, blockedId: MARTINA, createdAt: AHORA });
      await driver.repo.block({ blockerId: ANA, blockedId: LUCIA, createdAt: AHORA });
      await driver.repo.unblock(ANA, MARTINA);
      expect(await driver.repo.listBlockedIds(ANA)).toEqual(['lucia']);
    });

    it('desbloquear a quien no estaba bloqueado no rompe nada', async () => {
      await expect(driver.repo.unblock(ANA, LUCIA)).resolves.toBeUndefined();
    });

    it('la cola devuelve lo más viejo primero', async () => {
      await driver.repo.createReport(denuncia('r3', ANA, new Date('2026-09-03T10:00:00Z')));
      await driver.repo.createReport(denuncia('r1', MARTINA, new Date('2026-09-01T10:00:00Z')));
      await driver.repo.createReport(denuncia('r2', LUCIA, new Date('2026-09-02T10:00:00Z')));

      const cola = await driver.repo.listReports({ status: 'open' });
      expect(cola.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    });

    it('resolver saca de la cola abierta y deja quién y cuándo', async () => {
      await driver.repo.createReport(denuncia('r1', ANA, AHORA));
      expect(await driver.repo.countOpenReports()).toBe(1);

      const resuelta = await driver.repo.resolveReport(
        'r1',
        'actioned',
        MARTINA,
        new Date('2026-09-05T09:00:00Z'),
      );

      expect(resuelta.status).toBe('actioned');
      expect(String(resuelta.resolvedBy)).toBe('martina');
      expect(resuelta.resolvedAt?.toISOString()).toBe('2026-09-05T09:00:00.000Z');
      expect(await driver.repo.countOpenReports()).toBe(0);
      expect(await driver.repo.listReports({ status: 'open' })).toEqual([]);
    });

    it('lo que se guarda es lo que se lee', async () => {
      const original = denuncia('r1', ANA, AHORA);
      await driver.repo.createReport(original);
      const leida = await driver.repo.findReport('r1');

      expect(leida?.reporterId).toBe(original.reporterId);
      expect(leida?.target).toBe('live_message');
      expect(leida?.targetId).toBe('msg-r1');
      expect(leida?.reason).toBe('ofensivo');
      expect(leida?.detail).toBe('Insultos en el chat');
      expect(leida?.status).toBe('open');
      expect(leida?.createdAt.toISOString()).toBe(AHORA.toISOString());
    });

    it('una denuncia que no existe devuelve null, no revienta', async () => {
      expect(await driver.repo.findReport('no-existe')).toBeNull();
    });
  });
}
