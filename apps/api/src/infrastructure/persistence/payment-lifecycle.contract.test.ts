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
