import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asLiveSessionId, type UserId } from '@vivo/domain';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';
import { LiveService } from './application/services/live.service';
import { NotificationService } from './application/services/notification.service';
import { StoreService } from './application/services/store.service';
import {
  NOTIFICATION_PROVIDER,
  PUSH_DELIVERY_REPOSITORY,
  PUSH_SUBSCRIPTION_REPOSITORY,
} from './application/ports/tokens';
import type {
  PushDeliveryRepository,
  PushSubscriptionRepository,
} from './application/ports/repositories';

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
let deliveries: PushDeliveryRepository;

/**
 * Lo que el transporte recibió.
 *
 * Se afirma sobre esto y sobre `PushDelivery`, que son dos cosas distintas: uno
 * dice a qué dispositivos se intentó, el otro dice cuáles quedaron reservados.
 * La garantía del milestone vive en el segundo.
 */
const sent: Array<{ endpoints: string[]; title: string }> = [];

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
      send: async (input: { targets: readonly { endpoint: string }[]; message: { title: string } }) => {
        sent.push({ endpoints: input.targets.map((t) => t.endpoint), title: input.message.title });
        return { delivered: input.targets.map((t) => t.endpoint), gone: [] };
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
  subscriptions = app.get(PUSH_SUBSCRIPTION_REPOSITORY);
  deliveries = app.get(PUSH_DELIVERY_REPOSITORY);
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


describe('un aviso por vivo y por dispositivo', () => {
  /**
   * La condición que cierra M05, y que tiene que seguir siendo cierta después
   * de reconexiones, reintentos, reinicios de la API y anuncios concurrentes.
   *
   * Se afirma sobre `PushDelivery` y no sobre cuántas veces se llamó al
   * transporte, porque es la constancia que sobrevive a un reinicio. Contar
   * llamadas probaría la memoria de este proceso; contar filas prueba la
   * garantía.
   */
  async function goLive(auth: Record<string, string>, title: string): Promise<string> {
    const created = await http()
      .post('/seller/live')
      .set(auth)
      .send({ title, productIds: ['campera-roma'], mode: 'now' })
      .expect(201);
    return created.body.id as string;
  }

  /**
   * Deja a Ana siguiendo con aviso encendido, y devuelve cuántos dispositivos
   * tiene registrados.
   *
   * El número se lee, no se asume: los tests de arriba le dejaron varios
   * navegadores suscritos, y eso es exactamente el caso multi-dispositivo. Un
   * vivo tiene que producir una entrega **por dispositivo**, no una en total.
   */
  async function subscribeAna(): Promise<{ auth: Record<string, string>; devices: number }> {
    const auth = await authFor(BUYER);
    await http().post('/stores/plaza-moda/follow').set(auth).expect(201);
    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(auth)
      .send({ notifyOnLive: true })
      .expect(200);
    await http()
      .post('/notifications/subscriptions')
      .set(auth)
      .send(subscription('https://push.uy/telefono-de-ana'))
      .expect(204);

    const me = await http().get('/auth/me').set(auth).expect(200);
    const devices = (await subscriptions.listForUser(me.body.id as UserId)).length;
    return { auth, devices };
  }

  it('un vivo nuevo avisa una vez, y anunciarlo de nuevo no avisa otra', async () => {
    const { devices } = await subscribeAna();
    const seller = await authFor(SELLER);

    const liveA = await goLive(seller, 'Live A');
    // Una entrega por dispositivo: es lo correcto, no un duplicado.
    expect(await deliveries.countFor(asLiveSessionId(liveA), 'live_started')).toBe(devices);

    // Reconciliación: el mismo vivo se vuelve a anunciar, como pasaría tras un
    // reinicio de la API o un reintento de un barrido.
    const service = app.get(NotificationService);
    const live = app.get(LiveService);
    const session = await live.findSession(asLiveSessionId(liveA));
    const store = await app.get(StoreService).requireById(session!.storeId);

    await service.announceLiveStarted(session!, store);
    await service.announceLiveStarted(session!, store);

    expect(await deliveries.countFor(asLiveSessionId(liveA), 'live_started')).toBe(devices);
  });

  it('dos anuncios concurrentes del mismo vivo reservan una sola vez', async () => {
    // La carrera de dos réplicas. Sin la clave compuesta en la base, las dos
    // leerían "no hay entrega" y las dos enviarían.
    const { devices } = await subscribeAna();
    const seller = await authFor(SELLER);
    const liveId = await goLive(seller, 'Live concurrente');

    const service = app.get(NotificationService);
    const live = app.get(LiveService);
    const session = await live.findSession(asLiveSessionId(liveId));
    const store = await app.get(StoreService).requireById(session!.storeId);

    const results = await Promise.all([
      service.announceLiveStarted(session!, store),
      service.announceLiveStarted(session!, store),
      service.announceLiveStarted(session!, store),
    ]);

    // Ninguno reserva de nuevo: el anuncio del arranque ya se llevó el destino.
    expect(results.reduce((total, value) => total + value, 0)).toBe(0);
    expect(await deliveries.countFor(asLiveSessionId(liveId), 'live_started')).toBe(devices);
  });

  it('un vivo nuevo sí vuelve a avisar', async () => {
    // La constancia es por vivo, no por dispositivo: terminar uno y empezar
    // otro es un aviso legítimo.
    const { devices } = await subscribeAna();
    const seller = await authFor(SELLER);

    const liveA = await goLive(seller, 'Primero');
    await http().post(`/seller/live/${liveA}/end`).set(seller).expect(201);
    const liveB = await goLive(seller, 'Segundo');

    expect(await deliveries.countFor(asLiveSessionId(liveA), 'live_started')).toBe(devices);
    expect(await deliveries.countFor(asLiveSessionId(liveB), 'live_started')).toBe(devices);
  });

  it('con el aviso apagado no se reserva nada', async () => {
    const { auth: buyer } = await subscribeAna();
    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: false })
      .expect(200);

    const liveId = await goLive(await authFor(SELLER), 'Sin aviso');
    expect(await deliveries.countFor(asLiveSessionId(liveId), 'live_started')).toBe(0);
  });

  it('sin dispositivo suscrito no hay a quién avisarle', async () => {
    // Seguir con el aviso encendido no alcanza: hace falta que alguien haya
    // aceptado el permiso en algún navegador.
    const auth = await authFor(BUYER);
    await http().post('/stores/plaza-moda/follow').set(auth).expect(201);
    await http()
      .delete('/notifications/subscriptions')
      .send({ endpoint: 'https://push.uy/telefono-de-ana' })
      .expect(204);

    const liveId = await goLive(await authFor(SELLER), 'Sin dispositivos');
    expect(await deliveries.countFor(asLiveSessionId(liveId), 'live_started')).toBe(0);
  });

  it('el aviso lleva el nombre de la tienda y la URL del vivo', async () => {
    // Lo que el service worker necesita para abrir exactamente ese vivo, y
    // nada más: sin email, sin tokens, sin nada privado.
    await subscribeAna();
    const liveId = await goLive(await authFor(SELLER), 'Con datos');

    const message = sent.at(-1);
    expect(message?.title).toBe('🔴 Plaza Moda está en vivo');
    expect(message?.endpoints).toContain('https://push.uy/telefono-de-ana');

    const live = app.get(LiveService);
    const session = await live.findSession(asLiveSessionId(liveId));
    expect(session).not.toBeNull();
  });
});

describe('la preferencia se ve en la pantalla de la tienda', () => {
  it('apagarla se refleja en el detalle que lee la pantalla', async () => {
    // La pantalla dibuja el interruptor con lo que trae el detalle de la
    // tienda. Si el detalle no reflejara la preferencia, alguien vería
    // encendido algo que apagó — y volvería a apagarlo sin efecto.
    const buyer = await authFor(BUYER);

    await http().delete('/stores/plaza-moda/follow').set(buyer);
    await http().post('/stores/plaza-moda/follow').set(buyer).expect(201);

    const siguiendo = await http().get('/stores/plaza-moda').set(buyer).expect(200);
    expect(siguiendo.body.isFollowing).toBe(true);
    expect(siguiendo.body.notifyOnLive).toBe(true);

    await http()
      .put('/stores/plaza-moda/follow/notifications')
      .set(buyer)
      .send({ notifyOnLive: false })
      .expect(200);

    const apagado = await http().get('/stores/plaza-moda').set(buyer).expect(200);
    expect(apagado.body.isFollowing).toBe(true);
    expect(apagado.body.notifyOnLive).toBe(false);
  });
});
