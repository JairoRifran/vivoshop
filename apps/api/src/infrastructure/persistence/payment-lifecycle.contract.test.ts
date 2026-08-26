import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asOrderId } from '@vivo/domain';
import type { CreateOrderRequest } from '@vivo/shared';
import {
  BUYER,
  PRODUCT,
  STORE,
  VARIANT,
  createMemoryHarness,
  createPgliteHarness,
  loadOrder,
  loadProduct,
  type DriverHarness,
} from './testing/driver-harness';

/**
 * El ciclo de vida de un cobro, contra los dos drivers.
 *
 * Corre la misma suite sobre memoria y sobre PostgreSQL porque "anda en
 * Postgres" no alcanza: `DATA_DRIVER=memory` es la experiencia por defecto de
 * desarrollo, y las dos implementaciones tienen que ser indistinguibles en lo
 * que importa —idempotencia del aviso, stock, transiciones, atomicidad—.
 *
 * Todo pasa por `handleWebhook`. No hay un atajo de prueba que marque un pago
 * como aprobado: si estos tests pasan, el camino de producción pasa.
 */
const harnesses: Array<{ name: string; create: () => Promise<DriverHarness> }> = [
  { name: 'memory', create: createMemoryHarness },
  { name: 'postgres (pglite)', create: createPgliteHarness },
];

const request = (quantity = 1): CreateOrderRequest => ({
  lines: [{ productId: PRODUCT, variantId: VARIANT, quantity }],
  deliveryMethodId: 'uy-pickup',
  paymentMethodId: 'uy-mercadopago',
  installments: 1,
  address: null,
  buyerNote: null,
  liveSessionId: null,
});

let keyCounter = 0;
const freshKey = () => `pay-contract-${(keyCounter += 1)}-${'x'.repeat(8)}`;

for (const definition of harnesses) {
  describe(`ciclo de cobro — ${definition.name}`, () => {
    let harness: DriverHarness;

    beforeEach(async () => {
      await harness?.dispose();
      harness = await definition.create();
      await harness.setStock(PRODUCT, VARIANT, 5);
    });

    afterAll(async () => {
      await harness?.dispose();
    });

    /** Crea el pedido y devuelve el id de la intención del proveedor. */
    async function buy(quantity = 1) {
      const order = await harness.checkout.createOrder(BUYER, STORE, request(quantity), freshKey());
      const payment = await harness.checkout.startPayment(BUYER, asOrderId(order.id));
      return { orderId: order.id, intentId: payment.providerIntentId as string, payment };
    }

    async function settle(intentId: string, outcome: 'approved' | 'rejected') {
      const event = harness.provider.settle(intentId, outcome);
      if (!event) throw new Error('la intención no existe');
      return event;
    }

    it('el pedido nace pendiente y el cobro con la comisión congelada', async () => {
      const { payment } = await buy();

      expect(payment.status).toBe('pending');
      expect(payment.checkoutUrl).not.toBeNull();
      // 3% por defecto, redondeado a favor del vendedor, y las partes suman
      // exactamente el bruto.
      expect(payment.split.commissionRateBps).toBe(300);
      expect(payment.split.commissionMinor).toBe(
        Math.floor((payment.split.grossMinor * 300) / 10_000),
      );
      expect(payment.split.commissionMinor + payment.split.netMinor).toBe(
        payment.split.grossMinor,
      );
    });

    it('el pedido pasa a pagado solo cuando llega el aviso', async () => {
      const { orderId, intentId } = await buy();

      const before = await loadOrder(harness, orderId);
      expect(before?.status).toBe('pending_payment');

      const event = await settle(intentId, 'approved');
      await harness.payments.handleWebhook({
        body: event.body,
        headers: {},
        rawBody: JSON.stringify(event.body),
      });

      const after = await loadOrder(harness, orderId);
      expect(after?.status).toBe('paid');
      expect(after?.payment.status).toBe('approved');
      expect(after?.timeline.map((entry) => entry.status)).toEqual(['pending_payment', 'paid']);
    });

    it('el mismo aviso dos veces mueve el pedido una sola vez', async () => {
      const { orderId, intentId } = await buy(2);
      const event = await settle(intentId, 'approved');

      const deliver = () =>
        harness.payments.handleWebhook({
          body: event.body,
          headers: {},
          rawBody: JSON.stringify(event.body),
        });

      await deliver();
      const stockAfterFirst = await harness.readStock(PRODUCT, VARIANT);

      // El reintento del proveedor es lo normal, no la excepción.
      await deliver();
      await deliver();

      const order = await loadOrder(harness, orderId);
      expect(order?.status).toBe('paid');
      // Una sola entrada `paid`: sin idempotencia habría tres.
      expect(order?.timeline.filter((entry) => entry.status === 'paid')).toHaveLength(1);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(stockAfterFirst);
    });

    it('dos avisos simultáneos del mismo pago no se aplican los dos', async () => {
      const { orderId, intentId } = await buy();
      const event = await settle(intentId, 'approved');

      // De verdad concurrentes: no uno y después el otro.
      await Promise.all([
        harness.payments.handleWebhook({
          body: event.body,
          headers: {},
          rawBody: JSON.stringify(event.body),
        }),
        harness.payments.handleWebhook({
          body: event.body,
          headers: {},
          rawBody: JSON.stringify(event.body),
        }),
      ]);

      const order = await loadOrder(harness, orderId);
      expect(order?.timeline.filter((entry) => entry.status === 'paid')).toHaveLength(1);
    });

    it('un pago rechazado devuelve el stock a la góndola', async () => {
      const product = await loadProduct(harness, PRODUCT);
      const initial = product.variants[0]?.stock as number;

      const { orderId, intentId } = await buy(2);
      // Reservado en la creación del pedido, antes de saber si se cobra.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(initial - 2);

      const event = await settle(intentId, 'rejected');
      await harness.payments.handleWebhook({
        body: event.body,
        headers: {},
        rawBody: JSON.stringify(event.body),
      });

      const order = await loadOrder(harness, orderId);
      expect(order?.status).toBe('cancelled');
      expect(order?.payment.status).toBe('rejected');
      // Esto es lo que evita que abrir el checkout y cerrar la pestaña deje
      // unidades bloqueadas para siempre.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(initial);
    });

    it('un aviso viejo no retrocede un pago ya aprobado', async () => {
      const { orderId, intentId } = await buy();

      const approved = await settle(intentId, 'approved');
      await harness.payments.handleWebhook({
        body: approved.body,
        headers: {},
        rawBody: JSON.stringify(approved.body),
      });

      // El proveedor "vuelve atrás": otro aviso, con el pago en rechazado.
      const stale = await settle(intentId, 'rejected');
      await expect(
        harness.payments.handleWebhook({
          body: stale.body,
          headers: {},
          rawBody: JSON.stringify(stale.body),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_TRANSITION' });

      const order = await loadOrder(harness, orderId);
      expect(order?.status).toBe('paid');
    });

    it('reintentar el pago no abre un segundo cobro', async () => {
      const order = await harness.checkout.createOrder(BUYER, STORE, request(), freshKey());
      const first = await harness.checkout.startPayment(BUYER, asOrderId(order.id));
      const second = await harness.checkout.startPayment(BUYER, asOrderId(order.id));

      expect(second.id).toBe(first.id);
      expect(second.providerIntentId).toBe(first.providerIntentId);
    });

    it('no se puede pagar un pedido que ya no espera pago', async () => {
      const { orderId, intentId } = await buy();
      const event = await settle(intentId, 'approved');
      await harness.payments.handleWebhook({
        body: event.body,
        headers: {},
        rawBody: JSON.stringify(event.body),
      });

      await expect(harness.checkout.startPayment(BUYER, asOrderId(orderId))).rejects.toThrow();
    });

    // --- La reserva de stock del checkout ---------------------------------
    //
    // Reservar al crear el pedido es correcto: dos personas no pueden comprar
    // la última unidad. Sin vencimiento, la reserva es eterna — y eso estuvo
    // en producción, con siete pedidos reteniendo siete unidades que nadie
    // pagó nunca.
    //
    // El reloj se adelanta en vez de esperar. Prueba exactamente la misma
    // condición —la fecha límite quedó atrás— sin que la suite duerma.

    const TTL = 30 * 60;

    it('un checkout abandonado devuelve el stock al vencer', async () => {
      const antes = await harness.readStock(PRODUCT, VARIANT);
      const { orderId } = await buy(2);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes - 2);

      harness.clock.advance(TTL + 1);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(1);

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes);
      const order = await loadOrder(harness, orderId);
      expect(order?.status).toBe('cancelled');
      expect(order?.payment.status).toBe('expired');
    });

    it('antes del vencimiento no toca nada', async () => {
      const antes = await harness.readStock(PRODUCT, VARIANT);
      await buy(2);

      harness.clock.advance(TTL - 60);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(0);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes - 2);
    });

    it('el barrido es idempotente: correrlo de nuevo no inventa stock', async () => {
      // La consecuencia de que no lo fuera sería vender unidades que no están
      // en el depósito. Se corre tres veces a propósito.
      const antes = await harness.readStock(PRODUCT, VARIANT);
      await buy(2);
      harness.clock.advance(TTL + 1);

      expect(await harness.payments.expireLapsedCheckouts()).toBe(1);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(0);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(0);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes);
    });

    it('un pago aprobado consume la reserva: el barrido no la devuelve', async () => {
      const antes = await harness.readStock(PRODUCT, VARIANT);
      const { orderId, intentId } = await buy(2);

      const event = await settle(intentId, 'approved');
      await harness.payments.handleWebhook({
        body: event.body,
        headers: {},
        rawBody: JSON.stringify(event.body),
      });

      // Y ahora pasa el barrido, mucho después del vencimiento.
      harness.clock.advance(TTL * 10);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(0);

      // El stock quedó consumido, no devuelto: la mercadería se vendió.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes - 2);
      expect((await loadOrder(harness, orderId))?.status).toBe('paid');
    });

    it('un rechazo ya devolvió la reserva, y el barrido no la devuelve otra vez', async () => {
      const antes = await harness.readStock(PRODUCT, VARIANT);
      const { intentId } = await buy(2);

      const event = await settle(intentId, 'rejected');
      await harness.payments.handleWebhook({
        body: event.body,
        headers: {},
        rawBody: JSON.stringify(event.body),
      });
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes);

      harness.clock.advance(TTL + 1);
      expect(await harness.payments.expireLapsedCheckouts()).toBe(0);
      // Si el barrido volviera a liberar, acá habría más stock que al empezar:
      // unidades inventadas.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes);
    });

    it('la carrera aviso-aprobado contra barrido termina en un solo desenlace', async () => {
      /**
       * El caso que hay que probar de verdad.
       *
       * El comprador paga justo cuando la reserva vence. El aviso y el barrido
       * salen a la vez y los dos quieren mover el mismo pago. Uno tiene que
       * ganar y el otro no puede hacer nada — ni liberar stock que ya se
       * consumió, ni consumir stock que ya se liberó.
       *
       * Lo que lo garantiza no es una guarda especial de este barrido: es que
       * los dos pasan por la misma transacción, que toma el pago con
       * `SELECT … FOR UPDATE`, y por la máquina de estados, que deja salir de
       * `pending` una sola vez.
       */
      const antes = await harness.readStock(PRODUCT, VARIANT);
      const { orderId, intentId } = await buy(2);
      const event = await settle(intentId, 'approved');

      harness.clock.advance(TTL + 1);

      const [webhook, sweep] = await Promise.allSettled([
        harness.payments.handleWebhook({
          body: event.body,
          headers: {},
          rawBody: JSON.stringify(event.body),
        }),
        harness.payments.expireLapsedCheckouts(),
      ]);

      // Ninguno de los dos puede explotar: el que pierde se retira en silencio.
      expect(webhook.status).toBe('fulfilled');
      expect(sweep.status).toBe('fulfilled');

      const order = await loadOrder(harness, orderId);
      const stock = await harness.readStock(PRODUCT, VARIANT);

      // Un único resultado coherente, sea cual sea el que ganó: o se vendió y
      // el stock quedó consumido, o venció y volvió entero. Nunca la mezcla.
      if (order?.payment.status === 'approved') {
        expect(order.status).toBe('paid');
        expect(stock).toBe(antes - 2);
      } else {
        expect(order?.payment.status).toBe('expired');
        expect(order?.status).toBe('cancelled');
        expect(stock).toBe(antes);
      }
    });

    it('cien barridos en paralelo liberan una sola vez', async () => {
      // La versión bruta de lo anterior: si la exclusión dependiera de una
      // lectura previa en vez del lock, acá aparecerían unidades de la nada.
      const antes = await harness.readStock(PRODUCT, VARIANT);
      await buy(1);
      harness.clock.advance(TTL + 1);

      const results = await Promise.all(
        Array.from({ length: 100 }, () => harness.payments.expireLapsedCheckouts()),
      );

      expect(results.reduce((total, value) => total + value, 0)).toBe(1);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(antes);
    });

    it('un aviso que no reconocemos no rompe nada', async () => {
      await expect(
        harness.payments.handleWebhook({
          body: { id: 'evt-ajeno', type: 'payment', data: { id: 'pago-de-otro-sistema' } },
          headers: {},
          rawBody: '{}',
        }),
      ).resolves.toBeUndefined();

      // Y un cuerpo que ni siquiera es un aviso de pago tampoco.
      await expect(
        harness.payments.handleWebhook({ body: { type: 'plan' }, headers: {}, rawBody: '{}' }),
      ).resolves.toBeUndefined();
    });
  });
}
