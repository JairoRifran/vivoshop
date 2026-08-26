import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserId } from '@vivo/domain';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';
import { NOTIFICATION_PROVIDER, PUSH_SUBSCRIPTION_REPOSITORY } from './application/ports/tokens';
import type { PushSubscriptionRepository } from './application/ports/repositories';

/**
 * Los avisos, sobre HTTP real.
 *
 * Lo que se prueba no es que Web Push funcione —eso depende de servidores de
 * Google y Mozilla— sino las decisiones que sí son nuestras: que suscribirse
 * dos veces no duplique destinos, que darse de baja funcione sin sesión, y que
 * quien apagó el aviso deje de recibirlo.
 *
 * Todo gira alrededor de una asimetría: el permiso de notificaciones se pierde
 * una sola vez. Quien recibe un aviso que no pidió no silencia ese aviso;
 * silencia la aplicación, y no vuelve.
 */
let app: INestApplication;
let http: () => request.Agent;
let subscriptions: PushSubscriptionRepository;

/** Lo que el proveedor de avisos recibió, para poder afirmar sobre ello. */
const sent: Array<{ userIds: readonly UserId[]; title: string }> = [];

const BUYER = { email: 'ana@vivo.uy', password: 'vivo1234' };
const SELLER = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

async function authFor(credentials: { email: string; password: string }) {
  return { Authorization: `Bearer ${await tokenFor(credentials)}` };
}

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'clave-publica-del-navegador', auth: 'secreto-del-navegador' },
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
});

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.STREAMING_PROVIDER = 'mock';
  process.env.JWT_SECRET = 'notifications-integration-secret-000000';
  process.env.RATE_LIMIT = '100000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // El envío real depende de terceros. Lo que se afirma acá es a quién se le
    // mandó y cuántas veces, que es donde viven nuestras reglas.
    .overrideProvider(NOTIFICATION_PROVIDER)
    .useValue({
      key: 'spy',
      notify: async (input: { userIds: readonly UserId[]; title: string }) => {
        sent.push({ userIds: input.userIds, title: input.title });
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
  subscriptions = app.get(PUSH_SUBSCRIPTION_REPOSITORY);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('la clave pública', () => {
  it('es null cuando no hay avisos configurados', async () => {
    // Con `NOTIFICATION_PROVIDER=log`, el frontend lee esto como "acá no hay
    // avisos" y no le pide permiso a nadie. Pedir permiso para algo que no se
    // va a usar es la forma más rápida de perderlo para siempre.
    const response = await http().get('/notifications/public-key').expect(200);
    expect(response.body.publicKey).toBeNull();
  });

  it('es pública de verdad: no exige sesión', async () => {
    // El navegador la necesita antes de suscribirse, y la clave pública VAPID
    // está pensada para viajar al cliente.
    await http().get('/notifications/public-key').expect(200);
  });
});

describe('suscribirse', () => {
  it('exige sesión', async () => {
    await http()
      .post('/notifications/subscriptions')
      .send(subscription('https://push.uy/anonimo'))
      .expect(401);
  });

  it('guarda el destino de quien está en sesión', async () => {
    const auth = await authFor(BUYER);
    await http()
      .post('/notifications/subscriptions')
      .set(auth)
      .send(subscription('https://push.uy/uno'))
      .expect(204);

    const me = await http().get('/auth/me').set(auth).expect(200);
    const stored = await subscriptions.listForUser(me.body.id as UserId);
    expect(stored.map((entry) => entry.endpoint)).toContain('https://push.uy/uno');
  });

  it('suscribirse tres veces desde el mismo navegador deja un solo destino', async () => {
    // Si duplicara, un vivo mandaría el mismo aviso tres veces al mismo
    // teléfono. La identidad es el endpoint justamente para que no pueda pasar.
    const auth = await authFor(BUYER);
    const me = await http().get('/auth/me').set(auth).expect(200);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await http()
        .post('/notifications/subscriptions')
        .set(auth)
        .send(subscription('https://push.uy/repetido'))
        .expect(204);
    }

    const stored = await subscriptions.listForUser(me.body.id as UserId);
    expect(stored.filter((entry) => entry.endpoint === 'https://push.uy/repetido')).toHaveLength(1);
  });

  it('recorta el user agent', async () => {
    // Suficiente para reconocer el navegador en soporte; no tanto como para
    // que la columna sea un registro de qué usa cada persona.
    const auth = await authFor(BUYER);
    const me = await http().get('/auth/me').set(auth).expect(200);
    await http()
      .post('/notifications/subscriptions')
      .set(auth)
      .send({ ...subscription('https://push.uy/largo'), userAgent: 'x'.repeat(400) })
      .expect(204);

    const stored = await subscriptions.listForUser(me.body.id as UserId);
    expect(stored.find((item) => item.endpoint === 'https://push.uy/largo')?.userAgent).toHaveLength(
      120,
    );
  });

  it('rechaza un endpoint que no es una URL', async () => {
    const auth = await authFor(BUYER);
    await http()
      .post('/notifications/subscriptions')
      .set(auth)
      .send({ ...subscription('https://push.uy/x'), endpoint: 'no-soy-una-url' })
      .expect(400);
  });
});

describe('darse de baja', () => {
  it('no exige sesión, porque el caso que importa es el que ya no la tiene', async () => {
    // Alguien que revocó el permiso desde el navegador no tiene con qué pedir
    // la baja. Exigir sesión dejaría su destino vivo para siempre, recibiendo
    // envíos que nadie va a ver.
    const auth = await authFor(BUYER);
    await http()
      .post('/notifications/subscriptions')
      .set(auth)
      .send(subscription('https://push.uy/baja'))
      .expect(204);

    await http()
      .delete('/notifications/subscriptions')
      .send({ endpoint: 'https://push.uy/baja' })
      .expect(204);

    const me = await http().get('/auth/me').set(auth).expect(200);
    const stored = await subscriptions.listForUser(me.body.id as UserId);
    expect(stored.map((entry) => entry.endpoint)).not.toContain('https://push.uy/baja');
  });
});

describe('a quién se le avisa cuando una tienda sale al aire', () => {
  async function goLive(auth: Record<string, string>, title: string): Promise<void> {
    await http()
      .post('/seller/live')
      .set(auth)
      .send({ title, productIds: ['campera-roma'], mode: 'now' })
      .expect(201);
  }

  it('se avisa a los seguidores', async () => {
    const buyer = await authFor(BUYER);
    const me = await http().get('/auth/me').set(buyer).expect(200);
    await http().post('/stores/plaza-moda/follow').set(buyer).expect(201);

    await goLive(await authFor(SELLER), 'Otoño en Plaza Moda');

    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toContain('está en vivo');
    expect(sent[0]?.userIds.map(String)).toContain(String(me.body.id));
  });

  it('no se le avisa a quien apagó el aviso de esa tienda', async () => {
    /**
     * `notifyOnLive` existía en el dominio desde M01 y las dos consultas lo
     * ignoraban. Mientras no se enviaba nada, daba igual.
     *
     * Con avisos de verdad no da igual, y no solo por cortesía: quien recibe
     * uno que apagó no vuelve a apagar esa tienda, revoca el permiso del
     * navegador — y eso se lleva puestos los avisos de todas las demás.
     */
    const buyer = await authFor(BUYER);
    const me = await http().get('/auth/me').set(buyer).expect(200);

    await http().post('/stores/plaza-moda/follow').set(buyer).expect(201);
    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: false })
      .expect(200);

    await goLive(await authFor(SELLER), 'Sin aviso para Ana');

    const destinatarios = sent.at(-1)?.userIds.map(String) ?? [];
    expect(destinatarios).not.toContain(String(me.body.id));
  });

  it('se puede volver a encender', async () => {
    // Apagar no puede ser una puerta de una sola dirección: quien se arrepiente
    // tiene que poder volver sin dejar de seguir la tienda y seguirla de nuevo.
    const buyer = await authFor(BUYER);
    const me = await http().get('/auth/me').set(buyer).expect(200);

    await http().post('/stores/plaza-moda/follow').set(buyer).expect(201);
    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: false })
      .expect(200);
    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: true })
      .expect(200);

    await goLive(await authFor(SELLER), 'De vuelta');

    expect(sent.at(-1)?.userIds.map(String)).toContain(String(me.body.id));
  });

  it('cambiar la preferencia de una tienda que no seguís no existe', async () => {
    // La precondición se establece, no se hereda: los tests de arriba dejaron a
    // Ana siguiendo la tienda, y depender de ese orden es cómo una suite
    // empieza a mentir.
    const buyer = await authFor(BUYER);
    await http().delete('/stores/plaza-moda/follow').set(buyer);

    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: false })
      .expect(404);
  });
});
