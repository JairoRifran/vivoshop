import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { asLiveSessionId, asStoreId, type LiveSession } from '@vivo/domain';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LiveRepository } from '../../application/ports/repositories';
import type { VivoDatabase } from './drizzle/client';
import { DrizzleLiveRepository } from './drizzle/drizzle.repositories';
import { schema } from './drizzle/schema';
import { seedDatabase } from './drizzle/seed';
import { PasswordService } from '../security/password.service';
import { MemoryDatabase } from './memory/memory-database';
import { MemoryLiveRepository } from './memory/memory.repositories';

/**
 * The live channel, stored and read back, on both drivers.
 *
 * M02 added four columns to `live_sessions` and a nested `channel` object to
 * the entity. Two things can quietly go wrong there and only show up in
 * production: the channel round-trips through Postgres as three separate
 * columns, and half a channel must never come back as a channel — a row with a
 * provider but no id would hand a client a token request that can never
 * succeed.
 *
 * Both drivers run the same assertions, because `DATA_DRIVER=memory` is the
 * default development experience and "it works in Postgres" is not enough.
 */

const NOW = new Date('2026-03-01T18:00:00.000Z');

function sessionFixture(id: string, overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: asLiveSessionId(id),
    storeId: asStoreId('plaza-moda'),
    title: 'Contrato de canal',
    status: 'live',
    thumbnailUrl: null,
    scheduledAt: null,
    startedAt: NOW,
    endedAt: null,
    viewerCount: 0,
    peakViewerCount: 0,
    likeCount: 0,
    products: [],
    featuredProductId: null,
    channel: null,
    interruptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface Harness {
  readonly name: string;
  readonly sessions: LiveRepository;
  /** Writes a half-populated channel straight past the mapper. */
  writePartialChannel(id: string): Promise<void>;
  dispose(): Promise<void>;
}

async function memoryHarness(): Promise<Harness> {
  const db = new MemoryDatabase();
  await db.seed((plain) => new PasswordService().hash(plain), { now: NOW });
  const sessions = new MemoryLiveRepository(db);

  return {
    name: 'memory',
    sessions,
    async writePartialChannel(id) {
      const existing = db.liveSessions.get(id);
      if (!existing) throw new Error(`unknown session ${id}`);
      // The memory driver holds the entity itself, so the only way to express
      // "half a channel" is the same thing the mapper would reject.
      db.liveSessions.set(id, { ...existing, channel: null });
    },
    async dispose() {},
  };
}

async function pgliteHarness(): Promise<Harness> {
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
    sessions: new DrizzleLiveRepository(db),
    async writePartialChannel(id) {
      await client.query(
        'update live_sessions set channel_provider = $1, channel_id = null where id = $2',
        ['livekit', id],
      );
    },
    async dispose() {
      await client.close();
    },
  };
}

function describeDriver(create: () => Promise<Harness>): void {
  let harness: Harness;

  beforeAll(async () => {
    harness = await create();
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it('round-trips a channel', async () => {
    const id = `liv_contract_${harness.name.replace(/\W+/g, '_')}`;
    await harness.sessions.create(
      sessionFixture(id, {
        channel: { provider: 'livekit', channelId: 'live_abc', url: 'ws://127.0.0.1:7880' },
      }),
    );

    const stored = await harness.sessions.findById(asLiveSessionId(id));
    expect(stored?.channel).toEqual({
      provider: 'livekit',
      channelId: 'live_abc',
      url: 'ws://127.0.0.1:7880',
    });
  });

  it('accepts a channel with no url, which is what the mock provider returns', async () => {
    const id = `liv_nourl_${harness.name.replace(/\W+/g, '_')}`;
    await harness.sessions.create(
      sessionFixture(id, { channel: { provider: 'mock', channelId: 'mock_1', url: null } }),
    );

    const stored = await harness.sessions.findById(asLiveSessionId(id));
    expect(stored?.channel).toEqual({ provider: 'mock', channelId: 'mock_1', url: null });
  });

  it('clears the channel when a session is finalised', async () => {
    const id = `liv_clear_${harness.name.replace(/\W+/g, '_')}`;
    const created = await harness.sessions.create(
      sessionFixture(id, { channel: { provider: 'livekit', channelId: 'live_xyz', url: null } }),
    );

    await harness.sessions.update({
      ...created,
      status: 'ended',
      endedAt: NOW,
      channel: null,
      interruptedAt: null,
    });

    const stored = await harness.sessions.findById(asLiveSessionId(id));
    expect(stored?.channel).toBeNull();
  });

  it('round-trips the interruption timestamp', async () => {
    const id = `liv_int_${harness.name.replace(/\W+/g, '_')}`;
    const droppedAt = new Date('2026-03-01T18:04:30.000Z');
    await harness.sessions.create(
      sessionFixture(id, { status: 'interrupted', interruptedAt: droppedAt }),
    );

    const stored = await harness.sessions.findById(asLiveSessionId(id));
    expect(stored?.status).toBe('interrupted');
    expect(stored?.interruptedAt?.toISOString()).toBe(droppedAt.toISOString());
  });

  it('never returns half a channel', async () => {
    const id = `liv_partial_${harness.name.replace(/\W+/g, '_')}`;
    await harness.sessions.create(sessionFixture(id));
    await harness.writePartialChannel(id);

    const stored = await harness.sessions.findById(asLiveSessionId(id));
    // A provider with no channel id is not something a client can join, so it
    // must read as "no channel" rather than as a broken one.
    expect(stored?.channel).toBeNull();
  });
}

describe('live session channel · memory driver', () => describeDriver(memoryHarness));
describe('live session channel · postgres driver (pglite)', () => describeDriver(pgliteHarness));
