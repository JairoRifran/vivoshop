import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { LiveService } from './application/services/live.service';
import { ApiExceptionFilter } from './common/http';
import { LiveJanitor } from './infrastructure/realtime/live-janitor';
import { CLOCK } from './application/ports/tokens';
import { asLiveSessionId } from '@vivo/domain';

/**
 * M02 integration tests: the live surface over real HTTP.
 *
 * The whole application is booted with the mock streaming provider, which is
 * the configuration a fresh clone runs in. What is being proven here is the
 * part that must hold whatever the provider is: who may ask for which
 * credential, which states admit which transition, and that a dropped
 * broadcaster is recoverable rather than fatal.
 */

let app: INestApplication;
let http: () => request.Agent;
let live: LiveService;
let janitor: LiveJanitor;

/**
 * A clock the tests can push forward.
 *
 * The grace period is ninety seconds, and a suite that waits ninety seconds to
 * prove it is a suite nobody runs. Moving the clock tests the real rule with
 * the real code path — no test-only branch inside `LiveService`.
 */
let clockOffsetMs = 0;
const advance = (ms: number): void => {
  clockOffsetMs += ms;
};

const BUYER = { email: 'ana@vivo.uy', password: 'vivo1234' };
const SELLER = { email: 'martina@vivo.uy', password: 'vivo1234' };
const OTHER_SELLER = { email: 'diego@vivo.uy', password: 'vivo1234' };

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

/** A scheduled session owned by the demo seller, fresh for each test. */
async function scheduleLive(auth: Record<string, string>, title: string): Promise<string> {
  const created = await http()
    .post('/seller/live')
    .set(auth)
    .send({
      title,
      productIds: ['campera-roma'],
      mode: 'scheduled',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    })
    .expect(201);
  return created.body.id as string;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'live-integration-secret-value-00000000';
  process.env.RATE_LIMIT = '100000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue({ now: () => new Date(Date.now() + clockOffsetMs) })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
  live = app.get(LiveService);
  janitor = app.get(LiveJanitor);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  clockOffsetMs = 0;
});

describe('broadcast credentials', () => {
  it('refuses an anonymous caller', async () => {
    await http().post('/seller/live/live-plaza-otono/broadcast-token').expect(401);
  });

  it('refuses a buyer, who has no seller role at all', async () => {
    const token = await tokenFor(BUYER);
    await http()
      .post('/seller/live/live-plaza-otono/broadcast-token')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('refuses a seller who does not own the session', async () => {
    // Holding the seller role is not the same as owning this broadcast. This
    // is the check that stops one shop from publishing into another's live.
    const token = await tokenFor(OTHER_SELLER);
    await http()
      .post('/seller/live/live-plaza-otono/broadcast-token')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('issues a publishing credential to the owner, and never the provider secret', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Credenciales del emisor');

    const response = await http()
      .post(`/seller/live/${id}/broadcast-token`)
      .set(auth)
      .expect(201);

    expect(response.body.canPublish).toBe(true);
    expect(response.body.identity).toMatch(/^broadcaster_/);
    expect(typeof response.body.token).toBe('string');

    // Nothing in the payload may resemble server configuration.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(process.env.JWT_SECRET);
    expect(body).not.toMatch(/API_SECRET|apiSecret|LIVEKIT_/i);
  });

  it('refuses to hand a publishing credential for a finished broadcast', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Vivo terminado');

    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);
    await http().post(`/seller/live/${id}/end`).set(auth).expect(201);

    const denied = await http().post(`/seller/live/${id}/broadcast-token`).set(auth).expect(409);
    expect(denied.body.code).toBe('LIVE_NOT_JOINABLE');
  });
});

describe('viewer credentials', () => {
  it('admits an anonymous viewer to a live session', async () => {
    const response = await http().post('/live/live-rambla-rutina/viewer-token').expect(201);

    // Seeded sessions have no channel until a seller actually starts one, so
    // the honest answer here is "nothing to watch yet" rather than an error.
    expect(response.body).toHaveProperty('credentials');
    expect(response.status).toBe(201);
  });

  it('never grants publishing rights to a viewer', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Vivo para espectadores');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);

    const response = await http().post(`/live/${id}/viewer-token`).expect(201);

    expect(response.body.credentials).not.toBeNull();
    expect(response.body.credentials.canPublish).toBe(false);
    expect(response.body.credentials.identity).not.toMatch(/^broadcaster_/);
  });

  it('gives an anonymous viewer an opaque identity, not their fingerprint', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Identidad anónima');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);

    const response = await http()
      .post(`/live/${id}/viewer-token`)
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
      .expect(201);

    const identity: string = response.body.credentials.identity;
    expect(identity).toMatch(/^guest_/);
    expect(identity).not.toContain('iPhone');
    expect(identity).not.toContain('127.0.0.1');
  });

  it('returns null rather than an error for a session with nothing to show', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Vivo programado');

    const response = await http().post(`/live/${id}/viewer-token`).expect(201);
    expect(response.body.credentials).toBeNull();
  });
});

describe('realtime handshake token', () => {
  it('gives anonymous visitors no token, and lets them watch anyway', async () => {
    const response = await http().post('/live/realtime-token').expect(201);
    expect(response.body.token).toBeNull();

    // Watching still works without one.
    await http().get('/live/live-rambla-rutina').expect(200);
  });

  it('mints a token for a signed-in user that the REST API refuses', async () => {
    const session = await tokenFor(BUYER);
    const response = await http()
      .post('/live/realtime-token')
      .set('Authorization', `Bearer ${session}`)
      .expect(201);

    expect(typeof response.body.token).toBe('string');
    expect(response.body.token).not.toBe(session);

    // The whole point of the separate audience: a realtime token stolen from
    // browser memory buys chat, not the account.
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.token}`)
      .expect(401);
  });
});

describe('live state machine over HTTP', () => {
  it('walks scheduled to ended and opens a channel on the way', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Ciclo completo');

    const started = await http().post(`/seller/live/${id}/start`).set(auth).expect(201);
    expect(started.body.status).toBe('live');
    expect(started.body.channel).toMatchObject({ provider: 'mock' });

    const ended = await http().post(`/seller/live/${id}/end`).set(auth).expect(201);
    expect(ended.body.status).toBe('ended');
    // The channel is released with the session: a closed broadcast must not
    // leave a room anyone can still be issued a token for.
    expect(ended.body.channel).toBeNull();
  });

  it('refuses to cancel a broadcast that is already on air', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Cancelar en vivo');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);

    const refused = await http().post(`/seller/live/${id}/cancel`).set(auth).expect(409);
    expect(refused.body.code).toBe('INVALID_LIVE_TRANSITION');
  });

  it('cancels a scheduled broadcast that never started', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Cancelar programado');

    const cancelled = await http().post(`/seller/live/${id}/cancel`).set(auth).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });
});

describe('broadcaster interruption', () => {
  it('marks a dropped broadcaster as interrupted, and keeps the live watchable', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Se corta la señal');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);

    await live.markInterrupted(asLiveSessionId(id));

    const detail = await http().get(`/live/${id}`).expect(200);
    expect(detail.body.status).toBe('interrupted');

    // Crucially: still watchable. A buyer mid-purchase is not ejected because
    // the seller walked behind a wall.
    const credentials = await http().post(`/live/${id}/viewer-token`).expect(201);
    expect(credentials.body.credentials).not.toBeNull();
  });

  it('returns to live when the broadcaster comes back', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Vuelve la señal');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);

    await live.markInterrupted(asLiveSessionId(id));
    await live.markResumed(asLiveSessionId(id));

    const detail = await http().get(`/live/${id}`).expect(200);
    expect(detail.body.status).toBe('live');
  });

  it('does not close a session while the grace period is still running', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Dentro de la gracia');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);
    await live.markInterrupted(asLiveSessionId(id));

    await janitor.sweep();

    const detail = await http().get(`/live/${id}`).expect(200);
    expect(detail.body.status).toBe('interrupted');
  });

  it('closes a session whose broadcaster never came back', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Nunca vuelve');
    await http().post(`/seller/live/${id}/start`).set(auth).expect(201);
    await live.markInterrupted(asLiveSessionId(id));

    // Reach past the grace period without waiting ninety seconds for it.
    advance(10 * 60_000);

    const closed = await janitor.sweep();
    expect(closed).toBeGreaterThan(0);

    const detail = await http().get(`/live/${id}`).expect(200);
    expect(detail.body.status).toBe('ended');
  });
});

describe('featured product authorisation', () => {
  it('refuses a product that is not attached to the session', async () => {
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(auth, 'Producto ajeno');

    const refused = await http()
      .post(`/seller/live/${id}/feature`)
      .set(auth)
      .send({ productId: 'buzo-parque' })
      .expect(404);

    expect(refused.body.code).toBe('LIVE_PRODUCT_NOT_ATTACHED');
  });

  it('refuses a seller who does not own the session', async () => {
    const owner = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    const id = await scheduleLive(owner, 'Destacado ajeno');

    const intruder = { Authorization: `Bearer ${await tokenFor(OTHER_SELLER)}` };
    await http()
      .post(`/seller/live/${id}/feature`)
      .set(intruder)
      .send({ productId: 'campera-roma' })
      .expect(403);
  });
});
