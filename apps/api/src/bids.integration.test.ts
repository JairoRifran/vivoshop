import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';

/**
 * Modo Puja sobre HTTP.
 *
 * Lo que se prueba acá y no en los tests de contrato es la superficie: quién
 * puede llamar a qué, qué códigos salen por el cable, y —sobre todo— qué datos
 * viajan. Una puja se muestra en vivo a toda la sala, así que la pregunta
 * "¿qué sale de este endpoint?" es tan importante como "¿funciona?".
 */
let app: INestApplication;
let http: () => request.Agent;

const SELLER = { email: 'martina@vivo.uy', password: 'vivo1234' };
const BUYER_A = { email: 'ana@vivo.uy', password: 'vivo1234' };
const BUYER_B = { email: 'diego@vivo.uy', password: 'vivo1234' };

const LIVE = 'live-plaza-otono';

/**
 * Un producto por bloque.
 *
 * No es cosmético: una tienda no puede tener dos pujas abiertas del mismo
 * producto en el mismo vivo —lo impide un índice único parcial— y `open`
 * devuelve la que ya existe en vez de crear otra. Compartir producto entre
 * bloques haría que el segundo heredara las ofertas del primero, y los fallos
 * dirían cualquier cosa menos la verdad.
 */
const PRODUCTS = {
  quienOferta: 'campera-roma',
  queSale: 'pantalon-cordon',
  recorrido: 'buzo-parque',
  cierre: 'camisa-prado',
  ajeno: 'bolso-cordon',
} as const;

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DRIVER = 'memory';
  process.env.CACHE_DRIVER = 'memory';
  process.env.JWT_SECRET = 'integration-test-secret-value-000000000';
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

/** Deja el vivo al aire: sin eso, ofertar se rechaza y con razón. */
async function goLive(sellerToken: string): Promise<void> {
  await http().post(`/seller/live/${LIVE}/start`).set(bearer(sellerToken));
}

async function openSession(
  sellerToken: string,
  productId: string,
  overrides: Record<string, unknown> = {},
) {
  const product = await http().get(`/products/${productId}`).expect(200);
  const response = await http()
    .post('/seller/bids')
    .set(bearer(sellerToken))
    .send({
      liveSessionId: LIVE,
      productId,
      variantId: product.body.variants[0].id,
      ...overrides,
    })
    .expect(201);
  return response.body;
}

describe('quién puede ofertar', () => {
  let sellerToken: string;
  let session: { id: string };

  beforeAll(async () => {
    sellerToken = await tokenFor(SELLER);
    await goLive(sellerToken);
    session = await openSession(sellerToken, PRODUCTS.quienOferta);
  });

  it('cualquiera puede mirar una puja sin cuenta', async () => {
    // Mirar el vivo no pide login, y la puja es parte del vivo.
    const response = await http().get(`/bids?liveSessionId=${LIVE}`).expect(200);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('sin sesión iniciada no se puede ofertar', async () => {
    // Una oferta anónima no se puede honrar: si el vendedor la acepta, tiene
    // que haber a quién reservarle el producto.
    await http().post(`/bids/${session.id}/offers`).send({ amountMinor: 100_000 }).expect(401);
  });

  it('con sesión iniciada sí', async () => {
    const token = await tokenFor(BUYER_A);
    const response = await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(token))
      .send({ amountMinor: 100_000 })
      .expect(201);

    expect(response.body.leadingBid.amountMinor).toBe(100_000);
  });

  it('el vendedor no puede ofertar en su propia puja', async () => {
    const response = await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(sellerToken))
      .send({ amountMinor: 500_000 })
      // 403 y no 400: los datos están bien, lo que no puede es hacerlo.
      .expect(403);

    expect(response.body.code).toBe('CANNOT_BID_ON_OWN_STORE');
  });

  it('rechaza montos que no son enteros positivos', async () => {
    const token = await tokenFor(BUYER_B);
    for (const amountMinor of [0, -5_000, 1.5]) {
      await http()
        .post(`/bids/${session.id}/offers`)
        .set(bearer(token))
        .send({ amountMinor })
        .expect(400);
    }
  });

  it('rechaza un monto absurdo en vez de desbordar', async () => {
    const token = await tokenFor(BUYER_B);
    await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(token))
      .send({ amountMinor: Number.MAX_SAFE_INTEGER })
      .expect(400);
  });
});

describe('qué datos salen de una puja', () => {
  let sellerToken: string;
  let session: { id: string };

  beforeAll(async () => {
    sellerToken = await tokenFor(SELLER);
    await goLive(sellerToken);
    session = await openSession(sellerToken, PRODUCTS.queSale);
    const token = await tokenFor(BUYER_A);
    await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(token))
      .send({ amountMinor: 125_000 })
      .expect(201);
  });

  it('una oferta lleva nombre público y monto, y nada más', async () => {
    const response = await http().get(`/bids/${session.id}`).expect(200);
    const bid = response.body.bids[0];

    expect(Object.keys(bid).sort()).toEqual([
      'amountMinor',
      'bidderAvatarUrl',
      'bidderName',
      'createdAt',
      'currency',
      'id',
      'outcome',
    ]);
  });

  it('ningún id de usuario ni correo viaja en la respuesta pública', async () => {
    // La puja se muestra a toda la sala. Lo que la sala necesita es quién va
    // ganando y por cuánto; nada más tiene por qué salir.
    const response = await http().get(`/bids/${session.id}`).expect(200);
    const payload = JSON.stringify(response.body);

    expect(payload).not.toContain('ana@vivo.uy');
    expect(payload).not.toContain('buyerId');
    expect(payload).not.toContain('sellerId');
  });

  it('el mínimo siguiente lo calcula el servidor', async () => {
    // Para que el número que se le muestra al comprador no pueda diferir del
    // que lo va a rechazar.
    const response = await http().get(`/bids/${session.id}`).expect(200);
    expect(response.body.nextMinimumMinor).toBe(125_001);
  });

  it('quien ofertó ve su propia oferta; quien no, no ve ninguna', async () => {
    const mine = await http()
      .get(`/bids/${session.id}`)
      .set(bearer(await tokenFor(BUYER_A)))
      .expect(200);
    expect(mine.body.viewerBid?.amountMinor).toBe(125_000);

    const anonymous = await http().get(`/bids/${session.id}`).expect(200);
    expect(anonymous.body.viewerBid).toBeUndefined();
  });
});

describe('el recorrido completo', () => {
  let sellerToken: string;
  let tokenA: string;
  let tokenB: string;
  let session: { id: string; variantId: string };

  beforeAll(async () => {
    sellerToken = await tokenFor(SELLER);
    tokenA = await tokenFor(BUYER_A);
    tokenB = await tokenFor(BUYER_B);
    await goLive(sellerToken);
    session = await openSession(sellerToken, PRODUCTS.recorrido, {
      minimumIncrementMinor: 5_000,
    });
  });

  it('dos compradores se suben el precio', async () => {
    await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(tokenA))
      .send({ amountMinor: 100_000 })
      .expect(201);

    const segunda = await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(tokenB))
      .send({ amountMinor: 110_000 })
      .expect(201);

    expect(segunda.body.leadingBid.amountMinor).toBe(110_000);
    expect(segunda.body.bids).toHaveLength(2);
  });

  it('una oferta que no supera el incremento se rechaza con su mínimo', async () => {
    const response = await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(tokenA))
      .send({ amountMinor: 112_000 })
      .expect(400);

    expect(response.body.code).toBe('BID_TOO_LOW');
  });

  it('el vendedor acepta y el producto queda reservado', async () => {
    const detail = await http().get(`/bids/${session.id}`).expect(200);
    const winner = detail.body.leadingBid;

    const accepted = await http()
      .post(`/seller/bids/${session.id}/accept`)
      .set(bearer(sellerToken))
      .send({ bidId: winner.id })
      .expect(201);

    expect(accepted.body.status).toBe('reserved');
    expect(accepted.body.reservationSecondsLeft).toBeGreaterThan(0);
  });

  it('el ganador se reconoce por su propia oferta', async () => {
    const mine = await http().get(`/bids/${session.id}`).set(bearer(tokenB)).expect(200);
    expect(mine.body.viewerBid.outcome).toBe('accepted');

    const loser = await http().get(`/bids/${session.id}`).set(bearer(tokenA)).expect(200);
    expect(loser.body.viewerBid.outcome).toBe('lost');
  });

  it('ya no se puede ofertar', async () => {
    const response = await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(tokenA))
      .send({ amountMinor: 200_000 })
      .expect(409);

    expect(response.body.code).toBe('BID_SESSION_NOT_OPEN');
  });

  it('el ganador paga con el precio aceptado y la comisión sale de ahí', async () => {
    const detail = await http().get(`/bids/${session.id}`).expect(200);
    const bidId = detail.body.leadingBid.id;
    const store = await http().get('/stores/plaza-moda').expect(200);

    const order = await http()
      .post(`/checkout/${store.body.id}/orders`)
      .set(bearer(tokenB))
      .set('Idempotency-Key', `bid-itest-${Date.now()}`)
      .send({
        lines: [
          { productId: PRODUCTS.recorrido, variantId: session.variantId, quantity: 1, bidId },
        ],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    // El precio del pedido es el aceptado, no el de catálogo.
    expect(order.body.items[0].unitPriceMinor).toBe(110_000);

    const paid = await http()
      .post(`/orders/${order.body.id}/payment/simulate`)
      .set(bearer(tokenB))
      .send({ outcome: 'approved' })
      .expect(201);
    expect(paid.body.status).toBe('paid');

    // La comisión se calculó sobre lo aceptado. 3% de lo que se pagó.
    const payments = await http().get('/seller/payments').set(bearer(sellerToken)).expect(200);
    const payment = payments.body.find(
      (entry: { orderId: string }) => entry.orderId === order.body.id,
    );

    expect(payment.commissionRateBps).toBe(300);
    expect(payment.commissionMinor).toBe(Math.floor((payment.grossMinor * 300) / 10_000));
    expect(payment.commissionMinor + payment.netMinor).toBe(payment.grossMinor);
  });

  it('y la puja queda vendida', async () => {
    const detail = await http().get(`/bids/${session.id}`).expect(200);
    expect(detail.body.status).toBe('sold');
  });
});

describe('cerrar sin vender', () => {
  it('el vendedor cierra y las ofertas quedan sin efecto', async () => {
    const sellerToken = await tokenFor(SELLER);
    await goLive(sellerToken);
    const session = await openSession(sellerToken, PRODUCTS.cierre);

    await http()
      .post(`/bids/${session.id}/offers`)
      .set(bearer(await tokenFor(BUYER_A)))
      .send({ amountMinor: 90_000 })
      .expect(201);

    const closed = await http()
      .post(`/seller/bids/${session.id}/close`)
      .set(bearer(sellerToken))
      .expect(201);

    expect(closed.body.status).toBe('closed');
    expect(closed.body.bids.every((bid: { outcome: string }) => bid.outcome === 'lost')).toBe(true);
  });

  it('nadie más que el dueño puede cerrar o aceptar', async () => {
    const sellerToken = await tokenFor(SELLER);
    await goLive(sellerToken);
    const session = await openSession(sellerToken, PRODUCTS.ajeno);
    const intruso = await tokenFor(BUYER_A);

    await http().post(`/seller/bids/${session.id}/close`).set(bearer(intruso)).expect(404);
    await http()
      .post(`/seller/bids/${session.id}/accept`)
      .set(bearer(intruso))
      .send({ bidId: 'bid-inventado' })
      .expect(404);
  });
});
