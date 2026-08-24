import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';

/**
 * API integration tests.
 *
 * The whole Nest application is booted — real guards, real pipes, real
 * exception filter, real use cases — against the in-memory driver seeded with
 * the demo dataset. Only the outside world (payments, streaming, delivery) is
 * simulated, and it is simulated by the same provider implementations the dev
 * server uses.
 *
 * These tests are about the contract and the rules: who may call what, what a
 * failure looks like on the wire, and whether money and stock stay consistent
 * across a purchase.
 */

let app: INestApplication;
let http: () => request.Agent;

const BUYER = { email: 'ana@vivo.uy', password: 'vivo1234' };
const SELLER = { email: 'martina@vivo.uy', password: 'vivo1234' };

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

/**
 * A fresh idempotency key per call. Order creation requires one, so the tests
 * generate a unique key wherever they intend a distinct purchase, and reuse a
 * fixed one where they are deliberately testing a retry.
 */
let keySeed = 0;
const freshKey = (): string => `itest-${Date.now()}-${(keySeed += 1)}`;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.JWT_SECRET = 'integration-test-secret-value-000000000';
  // Throttling is a production concern; a test suite firing hundreds of
  // requests in a second is not the attacker it exists to stop.
  process.env.RATE_LIMIT = '100000';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  http = () => request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('health and configuration', () => {
  it('reports the active drivers and the deployed version', async () => {
    const response = await http().get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      dataDriver: 'memory',
      // Sin commit inyectado, que es lo que pasa fuera de un deploy.
      version: 'development',
    });

    // Y nada más. Este endpoint es público: cada campo que se agregue acá lo
    // ve cualquiera, así que la lista se revisa a propósito.
    expect(Object.keys(response.body).sort()).toEqual([
      'cacheDriver',
      'dataDriver',
      'status',
      'uptimeSeconds',
      'version',
    ]);
  });

  it('exposes the market configuration the clients render from', async () => {
    const response = await http().get('/markets').expect(200);
    const uruguay = response.body.find((market: { country: string }) => market.country === 'UY');

    expect(uruguay.currency).toBe('UYU');
    // Tax is a set of named rules, not one rate per country: that is what lets
    // a reduced or exempt product exist without changing the model.
    expect(uruguay.tax.defaultCategory).toBe('standard');
    expect(uruguay.tax.rules.standard).toMatchObject({
      treatment: 'included',
      rateBps: 2200,
      category: 'standard',
    });
    expect(Object.keys(uruguay.tax.rules).length).toBeGreaterThan(1);
    expect(uruguay.delivery.map((method: { kind: string }) => method.kind)).toEqual(
      expect.arrayContaining(['shipping', 'pickup', 'seller_coordination']),
    );
    expect(uruguay.address.regions).toHaveLength(19);
  });
});

describe('authentication', () => {
  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await http()
      .post('/auth/login')
      .send({ email: BUYER.email, password: 'incorrecta' })
      .expect(401);
    const unknownAccount = await http()
      .post('/auth/login')
      .send({ email: 'nadie@vivo.uy', password: 'incorrecta' })
      .expect(401);

    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknownAccount.body).toEqual(wrongPassword.body);
  });

  it('validates the registration payload field by field', async () => {
    const response = await http()
      .post('/auth/register')
      .send({ name: 'A', email: 'no-es-mail', password: '123' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.body.fieldErrors)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('registers a buyer and returns a usable session', async () => {
    const email = `nueva-${Date.now()}@vivo.uy`;
    const response = await http()
      .post('/auth/register')
      .send({ name: 'Nueva Compradora', email, password: 'claveSegura1' })
      .expect(201);

    expect(response.body.user.roles).toEqual(['buyer']);

    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.token}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe(email));
  });

  it('refuses a duplicate email', async () => {
    const response = await http()
      .post('/auth/register')
      .send({ name: 'Otra Ana', email: BUYER.email, password: 'claveSegura1' })
      .expect(409);
    expect(response.body.code).toBe('EMAIL_TAKEN');
  });

  it('closes protected routes to anonymous callers', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/orders').expect(401);
  });

  it('rejects a forged token', async () => {
    await http().get('/auth/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });
});

describe('public browsing', () => {
  it('lists running sessions with their store and featured product', async () => {
    const response = await http().get('/live?status=live').expect(200);
    expect(response.body.length).toBeGreaterThan(0);

    const [session] = response.body;
    expect(session.store.name).toBeTruthy();
    expect(session.viewerCount).toBeGreaterThan(0);
    expect(session.featuredProduct.priceMinor).toBeGreaterThan(0);
  });

  it('never exposes paused products in the public catalogue', async () => {
    const response = await http().get('/products?limit=100').expect(200);
    expect(response.body.every((product: { status: string }) => product.status === 'active')).toBe(
      true,
    );
  });

  it('serves a store by its public slug', async () => {
    const response = await http().get('/stores/plaza-moda').expect(200);
    expect(response.body.name).toBe('Plaza Moda');
    expect(response.body.deliveryMethodIds.length).toBeGreaterThan(0);
  });

  it('answers 404 with a machine-readable code', async () => {
    const response = await http().get('/stores/no-existe').expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns live chat history without authentication', async () => {
    const response = await http().get('/live/live-plaza-otono/messages').expect(200);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0].body).toBeTruthy();
  });
});

describe('checkout', () => {
  it('prices a purchase identically before and after signing in', async () => {
    const body = {
      lines: [{ productId: 'pantalon-cordon', variantId: 'pantalon-cordon-v1', quantity: 2 }],
      deliveryMethodId: 'uy-home-delivery',
      installments: 1,
    };

    const anonymous = await http().post('/checkout/plaza-moda/preview').send(body).expect(201);
    const token = await tokenFor(BUYER);
    const authenticated = await http()
      .post('/checkout/plaza-moda/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);

    expect(anonymous.body.totalMinor).toBe(authenticated.body.totalMinor);
    expect(anonymous.body.subtotalMinor).toBe(338000);
    expect(anonymous.body.shippingMinor).toBe(19000);
    expect(anonymous.body.totalMinor).toBe(357000);
    // Uruguay quotes IVA inside the price, so tax must never inflate the total.
    expect(anonymous.body.taxMinor).toBeLessThan(anonymous.body.totalMinor);
  });

  it('drops the shipping fee when the buyer picks up', async () => {
    const response = await http()
      .post('/checkout/plaza-moda/preview')
      .send({
        lines: [{ productId: 'pantalon-cordon', variantId: 'pantalon-cordon-v1', quantity: 1 }],
        deliveryMethodId: 'uy-pickup',
        installments: 1,
      })
      .expect(201);

    expect(response.body.shippingMinor).toBe(0);
  });

  it('requires an address for a shipped order', async () => {
    const token = await tokenFor(BUYER);
    const response = await http()
      .post('/checkout/plaza-moda/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'pantalon-cordon', variantId: 'pantalon-cordon-v1', quantity: 1 }],
        deliveryMethodId: 'uy-home-delivery',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
        address: null,
      })
      .expect(400);

    expect(response.body.code).toBe('ADDRESS_REQUIRED');
  });

  it('refuses to oversell a variant', async () => {
    const token = await tokenFor(BUYER);
    const response = await http()
      .post('/checkout/plaza-moda/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'campera-roma', variantId: 'campera-roma-v1', quantity: 99 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(409);

    expect(response.body.code).toBe('OUT_OF_STOCK');
  });

  it('completes a purchase, decrements stock and files the order', async () => {
    const token = await tokenFor(BUYER);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await http().get('/products/buzo-parque').expect(200);
    const variant = before.body.variants[0];

    const created = await http()
      .post('/checkout/plaza-moda/orders')
      .set(auth)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'buzo-parque', variantId: variant.id, quantity: 2 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 6,
        liveSessionId: 'live-plaza-otono',
      })
      .expect(201);

    expect(created.body.status).toBe('pending_payment');
    expect(created.body.payment.status).toBe('pending');
    expect(created.body.code).toMatch(/^VV-/);
    expect(created.body.payment.installments).toBe(6);

    // El pago no lo confirma el navegador: el endpoint de simulación empuja
    // el aviso por el mismo camino que el webhook del proveedor.
    const paid = await http()
      .post(`/orders/${created.body.id}/payment/simulate`)
      .set(auth)
      .send({ outcome: 'approved' })
      .expect(201);

    expect(paid.body.status).toBe('paid');
    expect(paid.body.timeline.map((event: { status: string }) => event.status)).toEqual([
      'pending_payment',
      'paid',
    ]);

    const after = await http().get('/products/buzo-parque').expect(200);
    expect(after.body.variants[0].stock).toBe(variant.stock - 2);

    const mine = await http().get('/orders').set(auth).expect(200);
    expect(mine.body.some((order: { id: string }) => order.id === created.body.id)).toBe(true);
  });

  it('returns the units to stock when an order is cancelled', async () => {
    const token = await tokenFor(BUYER);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await http().get('/products/camisa-prado').expect(200);
    const variant = before.body.variants[0];

    const created = await http()
      .post('/checkout/plaza-moda/orders')
      .set(auth)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'camisa-prado', variantId: variant.id, quantity: 1 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    const reserved = await http().get('/products/camisa-prado').expect(200);
    expect(reserved.body.variants[0].stock).toBe(variant.stock - 1);

    await http().post(`/orders/${created.body.id}/cancel`).set(auth).expect(201);

    const released = await http().get('/products/camisa-prado').expect(200);
    expect(released.body.variants[0].stock).toBe(variant.stock);
  });

  it('hides one buyer’s order from another buyer', async () => {
    const buyerToken = await tokenFor(BUYER);
    const sellerToken = await tokenFor(SELLER);

    const created = await http()
      .post('/checkout/plaza-moda/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'bolso-cordon', variantId: 'bolso-cordon-default', quantity: 1 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    await http()
      .get(`/orders/${created.body.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(404);
  });
});

describe('seller surface', () => {
  it('is closed to buyer-only accounts', async () => {
    const token = await tokenFor(BUYER);
    const response = await http()
      .get('/seller/metrics')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('computes dashboard metrics from real rows', async () => {
    const token = await tokenFor(SELLER);
    const response = await http()
      .get('/seller/metrics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.storeId).toBe('plaza-moda');
    expect(response.body.currency).toBe('UYU');
    expect(response.body.productsActive).toBeGreaterThan(0);
    expect(response.body.activeLive.status).toBe('live');
  });

  it('creates a product with variants and publishes it', async () => {
    const token = await tokenFor(SELLER);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await http()
      .post('/seller/products')
      .set(auth)
      .send({
        title: 'Gorro de lana',
        description: 'Tejido a mano.',
        basePriceMinor: 89000,
        variants: [
          { optionValues: { Talle: 'Único' }, stock: 4 },
          { optionValues: { Talle: 'Niño' }, stock: 2 },
        ],
        options: [{ name: 'Talle', values: ['Único', 'Niño'] }],
      })
      .expect(201);

    expect(created.body.stock).toBe(6);
    expect(created.body.variants).toHaveLength(2);
    expect(created.body.images.length).toBeGreaterThan(0);

    // It must be visible to buyers straight away.
    const publicView = await http().get(`/products/${created.body.id}`).expect(200);
    expect(publicView.body.title).toBe('Gorro de lana');

    const paused = await http().post(`/seller/products/${created.body.id}/toggle`).set(auth).expect(201);
    expect(paused.body.status).toBe('paused');
  });

  it('runs a broadcast from creation to end', async () => {
    const token = await tokenFor(SELLER);
    const auth = { Authorization: `Bearer ${token}` };

    const created = await http()
      .post('/seller/live')
      .set(auth)
      .send({
        title: 'Prueba de integración',
        productIds: ['campera-roma', 'buzo-parque'],
        mode: 'scheduled',
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(201);

    expect(created.body.status).toBe('scheduled');
    expect(created.body.productCount).toBe(2);

    const started = await http().post(`/seller/live/${created.body.id}/start`).set(auth).expect(201);
    expect(started.body.status).toBe('live');

    const featured = await http()
      .post(`/seller/live/${created.body.id}/feature`)
      .set(auth)
      .send({ productId: 'buzo-parque' })
      .expect(201);
    expect(featured.body.featuredProductId).toBe('buzo-parque');

    // The change is visible to buyers, which is the whole point of the control.
    const asBuyer = await http().get(`/live/${created.body.id}`).expect(200);
    expect(asBuyer.body.featuredProduct.id).toBe('buzo-parque');

    const ended = await http().post(`/seller/live/${created.body.id}/end`).set(auth).expect(201);
    expect(ended.body.status).toBe('ended');

    // Ending twice is a domain error, not a silent success.
    const again = await http().post(`/seller/live/${created.body.id}/end`).set(auth).expect(409);
    expect(again.body.code).toBe('INVALID_LIVE_TRANSITION');
  });

  it('refuses to attach another store’s products', async () => {
    const token = await tokenFor(SELLER);
    await http()
      .post('/seller/live')
      .set({ Authorization: `Bearer ${token}` })
      .send({ title: 'Ajeno', productIds: ['serum-rambla'], mode: 'now' })
      .expect(404);
  });

  it('advances an order only through legal transitions', async () => {
    const buyerToken = await tokenFor(BUYER);
    const sellerToken = await tokenFor(SELLER);
    const sellerAuth = { Authorization: `Bearer ${sellerToken}` };

    const created = await http()
      .post('/checkout/plaza-moda/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [{ productId: 'pantalon-cordon', variantId: 'pantalon-cordon-v2', quantity: 1 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    // Cannot ship an order nobody has paid for.
    const tooSoon = await http()
      .patch(`/seller/orders/${created.body.id}/status`)
      .set(sellerAuth)
      .send({ status: 'shipped' })
      .expect(409);
    expect(tooSoon.body.code).toBe('INVALID_ORDER_TRANSITION');

    await http()
      .post(`/orders/${created.body.id}/payment/simulate`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ outcome: 'approved' })
      .expect(201);

    const preparing = await http()
      .patch(`/seller/orders/${created.body.id}/status`)
      .set(sellerAuth)
      .send({ status: 'preparing', note: 'Armando el paquete' })
      .expect(200);
    expect(preparing.body.status).toBe('preparing');

    const shipped = await http()
      .patch(`/seller/orders/${created.body.id}/status`)
      .set(sellerAuth)
      .send({ status: 'shipped' })
      .expect(200);
    expect(shipped.body.status).toBe('shipped');

    const delivered = await http()
      .patch(`/seller/orders/${created.body.id}/status`)
      .set(sellerAuth)
      .send({ status: 'delivered' })
      .expect(200);
    expect(delivered.body.timeline).toHaveLength(5);
  });
});

describe('social and live interaction', () => {
  it('follows and unfollows a store, keeping the counter honest', async () => {
    const token = await tokenFor(BUYER);
    const auth = { Authorization: `Bearer ${token}` };

    const before = await http().get('/stores/cable-sur').expect(200);

    await http().post(`/stores/${before.body.id}/follow`).set(auth).expect(201);
    const followed = await http().get('/stores/cable-sur').set(auth).expect(200);
    expect(followed.body.isFollowing).toBe(true);
    expect(followed.body.followerCount).toBe(before.body.followerCount + 1);

    await http().delete(`/stores/${before.body.id}/follow`).set(auth).expect(200);
    const unfollowed = await http().get('/stores/cable-sur').set(auth).expect(200);
    expect(unfollowed.body.isFollowing).toBe(false);
    expect(unfollowed.body.followerCount).toBe(before.body.followerCount);
  });

  it('requires an account to comment but not to watch', async () => {
    await http()
      .post('/live/live-plaza-otono/messages')
      .send({ body: 'Hola' })
      .expect(401);

    const token = await tokenFor(BUYER);
    const posted = await http()
      .post('/live/live-plaza-otono/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '  ¿Hacen envíos a Rocha?  ' })
      .expect(201);

    expect(posted.body.body).toBe('¿Hacen envíos a Rocha?');
    expect(posted.body.authorName).toBe('Ana Pérez');
  });

  it('counts viewers through join and leave', async () => {
    const joined = await http().post('/live/live-rambla-rutina/join').expect(201);
    const seeded = 189;
    expect(joined.body.viewerCount).toBe(seeded + 1);

    const left = await http().post('/live/live-rambla-rutina/leave').expect(201);
    expect(left.body.viewerCount).toBe(seeded);
  });

  it('aggregates batched reactions', async () => {
    const before = await http().get('/live/live-rambla-rutina/stats').expect(200);
    await http().post('/live/live-rambla-rutina/reactions').send({ count: 12 }).expect(201);
    const after = await http().get('/live/live-rambla-rutina/stats').expect(200);

    expect(after.body.likeCount).toBe(before.body.likeCount + 12);
  });

  it('accepts analytics from signed-out visitors', async () => {
    await http()
      .post('/analytics/events')
      .send({ name: 'live_opened', properties: { liveSessionId: 'live-plaza-otono' } })
      .expect(204);
  });
});
