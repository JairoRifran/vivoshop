import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http';

/**
 * Confianza: el ✓, la verificación de identidad y la Compra Protegida.
 *
 * La mitad de este archivo prueba **ausencias**, y eso es a propósito. El
 * requisito de producto más fácil de romper sin darse cuenta es que la
 * verificación sea opcional: alcanza con que alguien agregue un guard "por las
 * dudas" en un endpoint de productos para que un vendedor particular sin RUT
 * quede afuera del producto. Estas pruebas existen para que ese cambio falle.
 */
let app: INestApplication;
let http: () => request.Agent;

const BUYER = { email: 'ana@vivo.uy', password: 'vivo1234' };
/** Dueña de `taller-ceibo`, que el dataset deja sin verificar. */
const INFORMAL_SELLER = { email: 'diego@vivo.uy', password: 'vivo1234' };

let keySeed = 0;
const freshKey = (): string => `trust-${Date.now()}-${(keySeed += 1)}`;

async function tokenFor(credentials: { email: string; password: string }): Promise<string> {
  const response = await http().post('/auth/login').send(credentials).expect(201);
  return response.body.token as string;
}

const NEGOCIO = {
  legalName: 'Taller Ceibo SRL',
  taxId: '210987654321',
  responsibleName: 'Diego Pérez',
  responsibleDocument: '3.456.789-0',
  commercialAddress: 'Bulevar Artigas 1234, Montevideo',
  contactPhone: '099887766',
  contactEmail: 'hola@tallerceibo.uy',
};

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

describe('el camino de un vendedor particular no pasa por la verificación', () => {
  let auth: Record<string, string>;
  let storeId: string;

  beforeAll(async () => {
    auth = { Authorization: `Bearer ${await tokenFor(INFORMAL_SELLER)}` };
    const store = await http().get('/stores/mine').set(auth).expect(200);
    storeId = store.body.id;
  });

  it('la tienda existe sin verificar y no lleva ninguna marca', async () => {
    const store = await http().get('/stores/taller-ceibo').expect(200);

    expect(store.body.isVerified).toBe(false);
    // Y nada más. No hay un `verificationStatus`, ni un `pending`, ni un
    // `rejected` visible: afuera solo existe "verificada" o nada, para que la
    // ausencia del tick no se lea como una advertencia.
    expect(store.body).not.toHaveProperty('verification');
    expect(store.body).not.toHaveProperty('verificationStatus');
  });

  it('puede cargar un producto sin haber presentado un RUT', async () => {
    const created = await http()
      .post('/seller/products')
      .set(auth)
      .send({
        title: 'Banco de madera',
        description: 'Hecho a mano en el taller.',
        basePriceMinor: 320_000,
        images: [],
        options: [],
        variants: [{ optionValues: {}, sku: null, priceMinor: null, stock: 4, active: true }],
      })
      .expect(201);

    expect(created.body.id).toBeTruthy();
  });

  it('puede transmitir sin haber presentado un RUT', async () => {
    const products = await http().get(`/products?storeId=${storeId}`).expect(200);

    const live = await http()
      .post('/seller/live')
      .set(auth)
      .send({ title: 'Tarde de taller', productIds: [products.body[0].id], mode: 'now' })
      .expect(201);

    expect(live.body.id).toBeTruthy();
  });

  it('puede vender y cobrar sin haber presentado un RUT', async () => {
    const buyerAuth = { Authorization: `Bearer ${await tokenFor(BUYER)}` };
    const products = await http().get(`/products?storeId=${storeId}`).expect(200);
    const product = await http().get(`/products/${products.body[0].id}`).expect(200);

    const order = await http()
      .post(`/checkout/${storeId}/orders`)
      .set(buyerAuth)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [
          {
            productId: product.body.id,
            variantId: product.body.variants[0].id,
            quantity: 1,
          },
        ],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    // El cobro se abre igual: el tick no es una capa de pagos.
    expect(order.body.payment.checkoutUrl).toBeTruthy();

    const paid = await http()
      .post(`/orders/${order.body.id}/payment/simulate`)
      .set(buyerAuth)
      .send({ outcome: 'approved' })
      .expect(201);

    expect(paid.body.status).toBe('paid');
  });
});

describe('el ✓ es de comercios, no de personas', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    auth = { Authorization: `Bearer ${await tokenFor(INFORMAL_SELLER)}` };
  });

  it('no hay verificación hasta que alguien la pide', async () => {
    const current = await http().get('/seller/verification/business').set(auth).expect(200);
    expect(current.body).toEqual({});
  });

  it('rechaza una solicitud sin identificador tributario', async () => {
    // El caso que hay que impedir: otorgar el tick con la sola identidad
    // personal de quien atiende el negocio.
    const { taxId: _omitted, ...sinRut } = NEGOCIO;
    const response = await http()
      .post('/seller/verification/business')
      .set(auth)
      .send(sinRut)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('acepta una solicitud completa y la deja pendiente', async () => {
    const response = await http()
      .post('/seller/verification/business')
      .set(auth)
      .send(NEGOCIO)
      .expect(201);

    expect(response.body.status).toBe('pending');
    expect(response.body.submittedAt).toBeTruthy();
  });

  it('pedir la verificación no otorga el tick', async () => {
    // Siempre hay una revisión en el medio. Si esto fallara, cualquiera se
    // pondría el ✓ escribiendo un RUT inventado.
    const store = await http().get('/stores/taller-ceibo').expect(200);
    expect(store.body.isVerified).toBe(false);
  });

  it('el estado pendiente lo ve su dueño y nadie más', async () => {
    const mine = await http().get('/seller/verification/business').set(auth).expect(200);
    expect(mine.body.status).toBe('pending');

    // Y la tienda pública no lo publica.
    const store = await http().get('/stores/taller-ceibo').expect(200);
    expect(JSON.stringify(store.body)).not.toContain('pending');
    expect(JSON.stringify(store.body)).not.toContain(NEGOCIO.taxId);
  });

  it('la verificación de identidad no pide nada del negocio', async () => {
    const response = await http()
      .post('/me/verification')
      .set(auth)
      .send({
        fullName: 'Diego Pérez',
        documentNumber: '3.456.789-0',
        documentType: 'CI',
        phone: '099887766',
        email: 'diego@vivo.uy',
      })
      .expect(201);

    expect(response.body.status).toBe('pending');
  });

  it('verificar la identidad tampoco otorga el tick', async () => {
    const store = await http().get('/stores/taller-ceibo').expect(200);
    expect(store.body.isVerified).toBe(false);
  });

  it('una tienda verificada del dataset sí lo muestra', async () => {
    const store = await http().get('/stores/plaza-moda').expect(200);
    expect(store.body.isVerified).toBe(true);
  });
});

describe('la promesa que se le muestra al comprador', () => {
  it('sale del servidor y describe lo que el proveedor puede sostener', async () => {
    const response = await http().get('/payments/capabilities').expect(200);

    // Con el proveedor de desarrollo, que sí retiene en su propio registro.
    expect(response.body.provider).toBe('fake');
    expect(response.body.level).toBe('full');
    expect(response.body.supportsDelayedSettlement).toBe(true);
  });

  it('no expone nada del proveedor más allá de sus capacidades', async () => {
    const response = await http().get('/payments/capabilities').expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'level',
      'provider',
      'supportsDelayedSettlement',
      'supportsDisputes',
      'supportsRefunds',
    ]);
  });
});

describe('la cuenta de cobro del vendedor', () => {
  let auth: Record<string, string>;

  beforeAll(async () => {
    auth = { Authorization: `Bearer ${await tokenFor(INFORMAL_SELLER)}` };
  });

  it('empieza sin conectar', async () => {
    const response = await http().get('/seller/payments/account').set(auth).expect(200);
    expect(response.body).toEqual({});
  });

  it('conectar devuelve una URL con state, y nunca un token', async () => {
    const response = await http().post('/seller/payments/connect').set(auth).expect(201);

    const url = new URL(response.body.authorizationUrl);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(Object.keys(response.body)).toEqual(['authorizationUrl']);
  });

  it('un `state` que no emitimos no conecta nada', async () => {
    const response = await http()
      .get('/payments/fake/oauth/callback?code=abc&state=inventado')
      .expect(302);

    expect(response.headers.location).toContain('conexion=error');
  });

  it('el mismo `state` no se puede usar dos veces', async () => {
    const started = await http().post('/seller/payments/connect').set(auth).expect(201);
    const state = new URL(started.body.authorizationUrl).searchParams.get('state') as string;

    const first = await http()
      .get(`/payments/fake/oauth/callback?code=abc&state=${state}`)
      .expect(302);
    expect(first.headers.location).toContain('conexion=lista');

    // Sin esto, un enlace filtrado seguiría sirviendo para reconectar.
    const replay = await http()
      .get(`/payments/fake/oauth/callback?code=abc&state=${state}`)
      .expect(302);
    expect(replay.headers.location).toContain('conexion=error');
  });

  it('la cuenta conectada se ve sin un solo token', async () => {
    const response = await http().get('/seller/payments/account').set(auth).expect(200);

    expect(response.body.status).toBe('connected');
    expect(Object.keys(response.body).sort()).toEqual([
      'accountLabel',
      'connectedAt',
      'provider',
      'status',
    ]);
    // Lo que nunca puede estar: la credencial con la que se cobra.
    expect(JSON.stringify(response.body)).not.toContain('fake-access');
    expect(JSON.stringify(response.body)).not.toContain('fake-refresh');
  });
});

describe('Compra Protegida, de punta a punta', () => {
  let buyerAuth: Record<string, string>;
  let sellerAuth: Record<string, string>;
  let orderId: string;

  beforeAll(async () => {
    buyerAuth = { Authorization: `Bearer ${await tokenFor(BUYER)}` };
    sellerAuth = { Authorization: `Bearer ${await tokenFor(INFORMAL_SELLER)}` };

    const store = await http().get('/stores/mine').set(sellerAuth).expect(200);
    const products = await http().get(`/products?storeId=${store.body.id}`).expect(200);
    const product = await http().get(`/products/${products.body[0].id}`).expect(200);

    const order = await http()
      .post(`/checkout/${store.body.id}/orders`)
      .set(buyerAuth)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [
          { productId: product.body.id, variantId: product.body.variants[0].id, quantity: 1 },
        ],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    orderId = order.body.id;
  });

  it('la compra nace elegible y todavia sin proteger', async () => {
    const order = await http().get(`/orders/${orderId}`).set(buyerAuth).expect(200);
    // Elegible porque el proveedor puede sostenerlo; no protegida porque
    // todavia no hay plata.
    expect(order.body.protection).toBe('eligible');
    expect(order.body.status).toBe('pending_payment');
  });

  it('el pago aprobado es lo que la protege', async () => {
    await http()
      .post(`/orders/${orderId}/payment/simulate`)
      .set(buyerAuth)
      .send({ outcome: 'approved' })
      .expect(201);

    const order = await http().get(`/orders/${orderId}`).set(buyerAuth).expect(200);
    expect(order.body.status).toBe('paid');
    expect(order.body.protection).toBe('protected');
  });

  it('no se puede dar por recibida una compra que no llego', async () => {
    const response = await http().post(`/orders/${orderId}/receipt`).set(buyerAuth).expect(409);
    expect(response.body.code).toBe('INVALID_ORDER_TRANSITION');
  });

  it('el comprador confirma cuando llego, y eso cierra la operacion', async () => {
    for (const status of ['preparing', 'shipped', 'delivered']) {
      await http()
        .patch(`/seller/orders/${orderId}/status`)
        .set(sellerAuth)
        .send({ status })
        .expect(200);
    }

    const completed = await http().post(`/orders/${orderId}/receipt`).set(buyerAuth).expect(201);

    // `completed` dice que la operacion comercial termino. No dice nada sobre
    // si el proveedor ya libero el dinero: son dos ejes distintos.
    expect(completed.body.status).toBe('completed');
    expect(completed.body.protection).toBe('resolved');
  });

  it('un pedido de otra persona no se puede tocar', async () => {
    await http().post(`/orders/${orderId}/receipt`).set(sellerAuth).expect(404);
    await http()
      .post(`/orders/${orderId}/dispute`)
      .set(sellerAuth)
      .send({ reason: 'not_received' })
      .expect(404);
  });
});

describe('un reclamo congela la compra', () => {
  let buyerAuth: Record<string, string>;
  let orderId: string;

  beforeAll(async () => {
    buyerAuth = { Authorization: `Bearer ${await tokenFor(BUYER)}` };
    const sellerAuth = { Authorization: `Bearer ${await tokenFor(INFORMAL_SELLER)}` };

    const store = await http().get('/stores/mine').set(sellerAuth).expect(200);
    const products = await http().get(`/products?storeId=${store.body.id}`).expect(200);
    const product = await http().get(`/products/${products.body[0].id}`).expect(200);

    const order = await http()
      .post(`/checkout/${store.body.id}/orders`)
      .set(buyerAuth)
      .set('Idempotency-Key', freshKey())
      .send({
        lines: [
          { productId: product.body.id, variantId: product.body.variants[0].id, quantity: 1 },
        ],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
      })
      .expect(201);

    orderId = order.body.id;
    await http()
      .post(`/orders/${orderId}/payment/simulate`)
      .set(buyerAuth)
      .send({ outcome: 'approved' })
      .expect(201);
  });

  it('abre el reclamo y marca la compra como reclamada', async () => {
    const dispute = await http()
      .post(`/orders/${orderId}/dispute`)
      .set(buyerAuth)
      .send({ reason: 'not_received', detail: 'Pasaron diez dias y no llego.' })
      .expect(201);

    expect(dispute.body.status).toBe('open');
    expect(dispute.body.reason).toBe('not_received');

    const order = await http().get(`/orders/${orderId}`).set(buyerAuth).expect(200);
    expect(order.body.protection).toBe('disputed');
  });

  it('reclamar dos veces no abre dos reclamos', async () => {
    const again = await http()
      .post(`/orders/${orderId}/dispute`)
      .set(buyerAuth)
      .send({ reason: 'damaged' })
      .expect(201);

    // Devuelve el que ya estaba, con su motivo original.
    expect(again.body.reason).toBe('not_received');
  });
});
