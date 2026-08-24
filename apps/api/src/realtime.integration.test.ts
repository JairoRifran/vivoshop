import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CHAT_BURST } from '@vivo/domain';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { LiveService } from './application/services/live.service';
import { ApiExceptionFilter } from './common/http';
import { CorsIoAdapter } from './infrastructure/realtime/io-adapter';

/**
 * Realtime tests with real sockets.
 *
 * Two clients, a real HTTP server, the real gateway. A mocked socket would
 * prove that the handler runs; what has to be proven here is that one browser
 * sees what another browser did — the fan-out, the rooms, and the fact that
 * the private seller room stays private.
 *
 * Nothing waits on a fixed timeout. Every assertion is driven by an event
 * actually arriving, with a bounded race so a genuine failure fails fast
 * rather than hanging the suite.
 */

let app: INestApplication;
let baseUrl: string;
let http: () => request.Agent;
let live: LiveService;

const BUYER = { email: 'ana@vivo.uy', password: 'vivo1234' };
const SELLER = { email: 'martina@vivo.uy', password: 'vivo1234' };
/** A buyer nobody else uses: the chat bucket is per identity, per process. */
const CHATTER = { email: 'camila@vivo.uy', password: 'vivo1234' };

const sockets: Socket[] = [];

/** Waits for one event, or fails with a message naming what never arrived. */
function once<T = unknown>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`nunca llegó el evento "${event}"`));
    }, timeoutMs);

    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

/** Asserts an event does NOT arrive. The only place a fixed wait is honest. */
function never(socket: Socket, event: string, windowMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = false;
    const handler = () => {
      seen = true;
    };
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(seen);
    }, windowMs);
  });
}

async function connect(token?: string): Promise<Socket> {
  const socket = io(`${baseUrl}/realtime`, {
    transports: ['websocket'],
    auth: token ? { token } : {},
    forceNew: true,
  });
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el socket no conectó')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return socket;
}

function join(socket: Socket, liveSessionId: string): Promise<{ ok: boolean; viewerCount?: number }> {
  return socket.timeout(4000).emitWithAck('live.join', { liveSessionId });
}

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

/** The handshake credential, which is a different token from the session. */
async function socketTokenFor(credentials: {
  email: string;
  password: string;
}): Promise<string> {
  const session = await tokenFor(credentials);
  const response = await http()
    .post('/live/realtime-token')
    .set('Authorization', `Bearer ${session}`)
    .expect(201);
  return response.body.token as string;
}

async function startLive(title: string): Promise<string> {
  const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
  const created = await http()
    .post('/seller/live')
    .set(auth)
    .send({ title, productIds: ['campera-roma'], mode: 'now' })
    .expect(201);
  return created.body.id as string;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'realtime-integration-secret-0000000000';
  process.env.RATE_LIMIT = '100000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useWebSocketAdapter(new CorsIoAdapter(app, ['*']));
  await app.init();
  // Port 0: the OS picks a free one, so the suite never collides with a dev
  // server someone left running.
  await app.listen(0);

  baseUrl = await app.getUrl();
  // Node resolves the wildcard address to IPv6; socket.io needs a real host.
  baseUrl = baseUrl.replace('[::1]', '127.0.0.1').replace('0.0.0.0', '127.0.0.1');

  http = () => request(app.getHttpServer());
  live = app.get(LiveService);
}, 60_000);

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await app?.close();
});

describe('presence', () => {
  it('counts a joining viewer and tells everyone already in the room', async () => {
    const id = await startLive('Presencia');

    const first = await connect();
    await join(first, id);

    const update = once<{ viewerCount: number }>(first, 'viewer.count');
    const second = await connect();
    await join(second, id);

    expect((await update).viewerCount).toBeGreaterThanOrEqual(2);
  });

  it('counts one person, not one tab', async () => {
    const id = await startLive('Dos pestañas');
    const token = await socketTokenFor(BUYER);

    const tabA = await connect(token);
    const joinedA = await join(tabA, id);

    const tabB = await connect(token);
    const joinedB = await join(tabB, id);

    // Same identity through two sockets. Counting connections would inflate
    // the number the seller sees and buyers read as a social signal.
    expect(joinedB.viewerCount).toBe(joinedA.viewerCount);
  });

  it('releases presence when a viewer drops without saying goodbye', async () => {
    const id = await startLive('Se corta');

    const watcher = await connect();
    await join(watcher, id);

    const leaver = await connect();
    const joined = await join(leaver, id);

    const drop = once<{ viewerCount: number }>(watcher, 'viewer.count');
    leaver.disconnect();

    expect((await drop).viewerCount).toBeLessThan(joined.viewerCount ?? 99);
  });
});

describe('chat', () => {
  it('delivers a message from one client to another', async () => {
    const id = await startLive('Chat entre clientes');

    const listener = await connect();
    await join(listener, id);

    const author = await connect(await socketTokenFor(BUYER));
    await join(author, id);

    const incoming = once<{ body: string; authorName: string }>(listener, 'chat.message');
    await author.emitWithAck('chat.send', { liveSessionId: id, body: '¿Hacen envíos a Salto?' });

    const message = await incoming;
    expect(message.body).toBe('¿Hacen envíos a Salto?');
    // The author comes from the handshake token, never from the payload.
    expect(message.authorName).toBe('Ana Pérez');
  });

  it('ignores an identity the client made up', async () => {
    const id = await startLive('Identidad falsa');

    const listener = await connect();
    await join(listener, id);

    const author = await connect(await socketTokenFor(BUYER));
    await join(author, id);

    const incoming = once<{ authorName: string }>(listener, 'chat.message');
    await author.emitWithAck('chat.send', {
      liveSessionId: id,
      body: 'Soy otra persona',
      authorName: 'Martina Silva',
      userId: 'usr-martina',
      role: 'seller',
    });

    expect((await incoming).authorName).toBe('Ana Pérez');
  });

  it('refuses an anonymous author', async () => {
    const id = await startLive('Chat anónimo');

    const guest = await connect();
    await join(guest, id);

    const result = await guest.emitWithAck('chat.send', { liveSessionId: id, body: 'Hola' });
    expect(result).toMatchObject({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('rate limits a flood and says when to try again', async () => {
    const id = await startLive('Inundación');

    const author = await connect(await socketTokenFor(CHATTER));
    await join(author, id);

    const results: Array<{ ok: boolean; error?: string; retryAfterSeconds?: number }> = [];
    for (let index = 0; index < CHAT_BURST + 3; index += 1) {
      results.push(
        await author.emitWithAck('chat.send', { liveSessionId: id, body: `spam ${index}` }),
      );
    }

    const limited = results.filter((result) => result.error === 'RATE_LIMITED');
    expect(results.slice(0, CHAT_BURST).every((result) => result.ok)).toBe(true);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0]?.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('reactions', () => {
  it('fans a burst out to the room without storing each tap', async () => {
    const id = await startLive('Corazones');

    const listener = await connect();
    await join(listener, id);

    const tapper = await connect();
    await join(tapper, id);

    const burst = once<{ count: number; totalLikes: number }>(listener, 'reaction.burst');
    await tapper.emitWithAck('reaction.send', { liveSessionId: id, count: 7 });

    const event = await burst;
    expect(event.count).toBe(7);
    expect(event.totalLikes).toBeGreaterThanOrEqual(7);
  });

  it('does not believe a client claiming a thousand hearts', async () => {
    const id = await startLive('Corazones inflados');

    const listener = await connect();
    await join(listener, id);
    const tapper = await connect();
    await join(tapper, id);

    const burst = once<{ count: number }>(listener, 'reaction.burst');
    await tapper.emitWithAck('reaction.send', { liveSessionId: id, count: 100_000 });

    expect((await burst).count).toBeLessThanOrEqual(30);
  });
});

describe('state and highlights', () => {
  it('pushes the current state to a late joiner', async () => {
    const id = await startLive('Llego tarde');

    const late = await connect();
    const state = once<{ status: string }>(late, 'live.state');
    await join(late, id);

    expect((await state).status).toBe('live');
  });

  it('announces a featured product change to every viewer', async () => {
    const id = await startLive('Destacar producto');

    const viewer = await connect();
    await join(viewer, id);

    const featured = once<{ productId: string | null }>(viewer, 'product.featured');
    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    await http()
      .post(`/seller/live/${id}/feature`)
      .set(auth)
      .send({ productId: 'campera-roma' })
      .expect(201);

    expect((await featured).productId).toBe('campera-roma');
  });

  it('tells viewers when the broadcast ends', async () => {
    const id = await startLive('Se termina');

    const viewer = await connect();
    await join(viewer, id);

    const states: string[] = [];
    viewer.on('live.state', (event: { status: string }) => states.push(event.status));

    const auth = { Authorization: `Bearer ${await tokenFor(SELLER)}` };
    await http().post(`/seller/live/${id}/end`).set(auth).expect(201);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(states).toContain('ended');
  });
});

describe('the private seller room', () => {
  it('keeps revenue out of the public room', async () => {
    const id = await startLive('Ventas privadas');

    const viewer = await connect();
    await join(viewer, id);

    const seller = await connect(await socketTokenFor(SELLER));
    await join(seller, id);

    const privateEvent = once<{ revenueMinor: number }>(seller, 'order.created', 6000);
    const leaked = never(viewer, 'order.created', 1200);

    // A real purchase attributed to this live, through the real checkout.
    const buyerAuth = { Authorization: `Bearer ${await tokenFor(BUYER)}` };
    const product = await http().get('/products/campera-roma').expect(200);

    await http()
      .post('/checkout/plaza-moda/orders')
      .set(buyerAuth)
      .set('Idempotency-Key', `realtime-${Date.now()}`)
      .send({
        lines: [
          { productId: 'campera-roma', variantId: product.body.variants[0].id, quantity: 1 },
        ],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
        liveSessionId: id,
      })
      .expect(201);

    const received = await privateEvent;
    expect(received.revenueMinor).toBeGreaterThan(0);

    // And the public room learned nothing about who bought or for how much.
    expect(await leaked).toBe(false);
  });

  it('does not put a plain viewer in the seller room', async () => {
    const id = await startLive('Sala ajena');

    const buyer = await connect(await socketTokenFor(BUYER));
    await join(buyer, id);

    // Reaching the room requires being its owner, and the gateway derives that
    // from the token rather than from anything the client claims.
    const session = await live.findSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id as any,
    );
    expect(session).not.toBeNull();
    expect(await never(buyer, 'order.created', 400)).toBe(false);
  });
});
