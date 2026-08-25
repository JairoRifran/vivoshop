import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asBidSessionId, asOrderId, asUserId } from '@vivo/domain';
import type { CreateOrderRequest } from '@vivo/shared';
import {
  PRODUCT,
  SELLER,
  SELLER_LIVE,
  STORE,
  VARIANT,
  createMemoryHarness,
  createPgliteHarness,
  loadOrder,
  type DriverHarness,
} from './testing/driver-harness';

/**
 * Modo Puja, contra los dos drivers.
 *
 * Lo que de verdad se prueba acá es la concurrencia. El resto del milestone
 * puede razonarse leyendo; "dos vendedores aceptan a la vez y hay un solo
 * ganador" no —hay que ejecutarlo, y hay que ejecutarlo contra PostgreSQL, que
 * es donde el lock existe de verdad—.
 *
 * Las carreras son reales: `Promise.all` sobre las dos operaciones, no una y
 * después la otra.
 */
const harnesses = [
  { name: 'memory', create: createMemoryHarness },
  { name: 'postgres (pglite)', create: createPgliteHarness },
];

const ANA = asUserId('ana');
const OTRO = asUserId('diego');
const MARTINA = asUserId(SELLER);

let keySeed = 0;
const freshKey = () => `bid-contract-${(keySeed += 1)}-${'x'.repeat(8)}`;

for (const definition of harnesses) {
  describe(`Modo Puja — ${definition.name}`, () => {
    let harness: DriverHarness;

    beforeEach(async () => {
      await harness?.dispose();
      harness = await definition.create();
      await harness.setStock(PRODUCT, VARIANT, 1);
    });

    afterAll(async () => {
      await harness?.dispose();
    });

    const openSession = (overrides: Record<string, unknown> = {}) =>
      harness.bids.open(MARTINA, {
        liveSessionId: SELLER_LIVE,
        productId: PRODUCT,
        variantId: VARIANT,
        minimumBidMinor: null,
        minimumIncrementMinor: null,
        ...overrides,
      } as never);

    // --- Abrir ------------------------------------------------------------

    it('abre una puja con el precio de referencia congelado del catálogo', async () => {
      const session = await openSession();

      expect(session.status).toBe('open');
      expect(session.referencePriceMinor).toBeGreaterThan(0);
      expect(session.acceptedBidId).toBeNull();
      // El stock no se toca al abrir: recién se reserva cuando alguien gana.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(1);
    });

    it('abrir dos veces el mismo producto no abre dos pujas', async () => {
      const primera = await openSession();
      const segunda = await openSession();
      expect(segunda.id).toBe(primera.id);
    });

    // --- Ofertar ----------------------------------------------------------

    it('acepta una oferta válida y la deja liderando', async () => {
      const session = await openSession();
      const { bid, leadingChanged } = await harness.bids.submit(ANA, session.id, {
        amountMinor: 100_000,
      });

      expect(bid.amountMinor).toBe(100_000);
      expect(bid.status).toBe('active');
      expect(leadingChanged).toBe(true);
    });

    it('rechaza una oferta por debajo del mínimo', async () => {
      const session = await openSession({ minimumBidMinor: 100_000 });
      await expect(
        harness.bids.submit(ANA, session.id, { amountMinor: 99_999 }),
      ).rejects.toMatchObject({ code: 'BID_TOO_LOW' });
    });

    it('rechaza una oferta con incremento insuficiente', async () => {
      const session = await openSession({ minimumIncrementMinor: 10_000 });
      await harness.bids.submit(ANA, session.id, { amountMinor: 100_000 });

      await expect(
        harness.bids.submit(OTRO, session.id, { amountMinor: 105_000 }),
      ).rejects.toMatchObject({ code: 'BID_TOO_LOW' });
      await expect(
        harness.bids.submit(OTRO, session.id, { amountMinor: 110_000 }),
      ).resolves.toBeTruthy();
    });

    it('el vendedor no puede ofertar en su propia puja', async () => {
      const session = await openSession();
      await expect(
        harness.bids.submit(MARTINA, session.id, { amountMinor: 500_000 }),
      ).rejects.toMatchObject({ code: 'CANNOT_BID_ON_OWN_STORE' });
    });

    it('dos compradores ofertando a la vez producen un solo líder', async () => {
      // Con incremento mínimo, las dos ofertas compiten contra el mismo líder.
      // Sin el lock, las dos pasarían la validación y quedarían dos "válidas"
      // que en realidad no se superaron entre sí.
      const session = await openSession({ minimumIncrementMinor: 10_000 });
      await harness.bids.submit(ANA, session.id, { amountMinor: 100_000 });

      const resultados = await Promise.allSettled([
        harness.bids.submit(OTRO, session.id, { amountMinor: 110_000 }),
        harness.bids.submit(OTRO, session.id, { amountMinor: 110_000 }),
      ]);

      const aceptadas = resultados.filter((r) => r.status === 'fulfilled');
      expect(aceptadas).toHaveLength(1);

      const { bids } = await harness.bids.bidsFor(session.id);
      expect(bids).toHaveLength(2);
      expect(bids[0]?.amountMinor).toBe(110_000);
    });

    it('no se puede ofertar en una puja cerrada', async () => {
      const session = await openSession();
      await harness.bids.close(MARTINA, session.id);

      await expect(
        harness.bids.submit(ANA, session.id, { amountMinor: 100_000 }),
      ).rejects.toMatchObject({ code: 'BID_SESSION_NOT_OPEN' });
    });

    // --- Aceptar ------------------------------------------------------------

    it('aceptar reserva la unidad y cierra la puja a nuevas ofertas', async () => {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 135_000 });

      const accepted = await harness.bids.accept(MARTINA, session.id, bid.id);

      expect(accepted.session.status).toBe('reserved');
      expect(String(accepted.session.acceptedBidId)).toBe(String(bid.id));
      expect(accepted.bid.status).toBe('accepted');
      expect(accepted.session.reservedUntil).toBeInstanceOf(Date);
      // La unidad sale de la góndola: nadie más puede llevársela mientras el
      // ganador paga.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    it('DOS ACEPTACIONES SIMULTÁNEAS PRODUCEN UN SOLO GANADOR', async () => {
      // El test que justifica todo el diseño: el lock de la sesión, la
      // transacción, y que la reserva de stock viva adentro.
      const session = await openSession();
      const primera = await harness.bids.submit(ANA, session.id, { amountMinor: 100_000 });
      const segunda = await harness.bids.submit(OTRO, session.id, { amountMinor: 130_000 });

      const resultados = await Promise.allSettled([
        harness.bids.accept(MARTINA, session.id, primera.bid.id),
        harness.bids.accept(MARTINA, session.id, segunda.bid.id),
      ]);

      const ganadores = resultados.filter((r) => r.status === 'fulfilled');
      expect(ganadores).toHaveLength(1);

      const perdedor = resultados.find((r) => r.status === 'rejected');
      expect(perdedor).toBeDefined();

      const final = await harness.bidRepo.findSession(session.id);
      expect(final?.status).toBe('reserved');
      expect(final?.acceptedBidId).not.toBeNull();
      // Y una sola unidad salió del stock, no dos.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    it('aceptar la misma oferta dos veces es idempotente', async () => {
      // Un timeout de red no puede dejar al vendedor sin saber si aceptó.
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });

      const primera = await harness.bids.accept(MARTINA, session.id, bid.id);
      const reintento = await harness.bids.accept(MARTINA, session.id, bid.id);

      expect(String(reintento.session.acceptedBidId)).toBe(String(primera.session.acceptedBidId));
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    it('no se puede aceptar una oferta de una puja ya cerrada', async () => {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });
      await harness.bids.close(MARTINA, session.id);

      await expect(harness.bids.accept(MARTINA, session.id, bid.id)).rejects.toMatchObject({
        code: 'BID_SESSION_NOT_OPEN',
      });
    });

    it('no se puede aceptar una oferta de otra sesión', async () => {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });

      await expect(
        harness.bids.accept(MARTINA, asBidSessionId('bs-inventada'), bid.id),
      ).rejects.toBeTruthy();
    });

    it('aceptar sin stock falla en vez de reservar lo que no hay', async () => {
      await harness.setStock(PRODUCT, VARIANT, 0);
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });

      await expect(harness.bids.accept(MARTINA, session.id, bid.id)).rejects.toMatchObject({
        code: 'OUT_OF_STOCK',
      });

      const final = await harness.bidRepo.findSession(session.id);
      expect(final?.status).toBe('open');
    });

    // --- Cerrar sin vender ----------------------------------------------------

    it('el vendedor puede cerrar sin aceptar ninguna oferta', async () => {
      const session = await openSession();
      await harness.bids.submit(ANA, session.id, { amountMinor: 100_000 });

      const closed = await harness.bids.close(MARTINA, session.id);

      expect(closed.status).toBe('closed');
      expect(closed.closedReason).toBe('seller');
      expect(closed.acceptedBidId).toBeNull();
      // Nada salió del stock: no hubo venta.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(1);
    });

    // --- Checkout con el precio aceptado ---------------------------------------

    async function winAndCheckout(amountMinor: number) {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor });
      await harness.bids.accept(MARTINA, session.id, bid.id);

      const request: CreateOrderRequest = {
        lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 1, bidId: String(bid.id) }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
        installments: 1,
        address: null,
        buyerNote: null,
        liveSessionId: null,
      };

      const order = await harness.checkout.createOrder(ANA, STORE, request, freshKey());
      return { session, bid, order };
    }

    it('el pedido congela el precio aceptado y de dónde salió', async () => {
      const { bid, order } = await winAndCheckout(135_000);

      const stored = await loadOrder(harness, order.id);
      const line = stored?.items[0];

      expect(line?.unitPriceMinor).toBe(135_000);
      expect(line?.priceSource).toBe('accepted_bid');
      expect(String(line?.bidId)).toBe(String(bid.id));
      // Y no el de catálogo, que es distinto.
      expect(line?.unitPriceMinor).not.toBe(249_000);
    });

    it('el checkout de una puja NO vuelve a descontar stock', async () => {
      // La unidad ya salió al aceptar. Descontarla de nuevo cobraría dos
      // unidades por una compra, y solo se notaría en el inventario.
      const { order } = await winAndCheckout(135_000);

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
      expect(order.totalMinor).toBeGreaterThan(0);
    });

    it('el pedido queda atado a la puja', async () => {
      const { session, order } = await winAndCheckout(120_000);
      const updated = await harness.bidRepo.findSession(session.id);
      expect(String(updated?.orderId)).toBe(order.id);
    });

    it('nadie puede pagar la oferta de otra persona', async () => {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });
      await harness.bids.accept(MARTINA, session.id, bid.id);

      await expect(
        harness.checkout.createOrder(
          OTRO,
          STORE,
          {
            lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 1, bidId: String(bid.id) }],
            deliveryMethodId: 'uy-pickup',
            paymentMethodId: 'uy-mercadopago',
            installments: 1,
            address: null,
            buyerNote: null,
            liveSessionId: null,
          },
          freshKey(),
        ),
      ).rejects.toBeTruthy();
    });

    it('una oferta que no fue aceptada no sirve para comprar barato', async () => {
      // El intento obvio: ofertar $1 y mandar ese bidId al checkout.
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 100 });

      await expect(
        harness.checkout.createOrder(
          ANA,
          STORE,
          {
            lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 1, bidId: String(bid.id) }],
            deliveryMethodId: 'uy-pickup',
            paymentMethodId: 'uy-mercadopago',
            installments: 1,
            address: null,
            buyerNote: null,
            liveSessionId: null,
          },
          freshKey(),
        ),
        // Los errores de dominio llevan `code` arriba; los de Nest, adentro
        // de `response`. Lo que importa es que el código sea estable.
      ).rejects.toMatchObject({ response: { code: 'BID_NOT_ACTIVE' } });
    });

    // --- Reserva vencida --------------------------------------------------------

    it('la reserva vencida devuelve el stock y deja decidir al vendedor', async () => {
      const session = await openSession();
      const { bid } = await harness.bids.submit(ANA, session.id, { amountMinor: 120_000 });
      await harness.bids.accept(MARTINA, session.id, bid.id);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);

      // Se fuerza el vencimiento en vez de esperar cinco minutos.
      const reserved = await harness.bidRepo.findSession(session.id);
      await harness.bidRepo.saveSession({
        ...(reserved as NonNullable<typeof reserved>),
        reservedUntil: new Date(Date.now() - 1_000),
      });

      const expired = await harness.bids.expireLapsedReservations();
      expect(expired).toBe(1);

      const after = await harness.bidRepo.findSession(session.id);
      expect(after?.status).toBe('expired');
      expect(after?.acceptedBidId).toBeNull();
      // Y la unidad volvió a la góndola.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(1);
    });

    it('una reserva con pedido NO se vence: el stock lo gobierna el pedido', async () => {
      const { session } = await winAndCheckout(120_000);

      const withOrder = await harness.bidRepo.findSession(session.id);
      await harness.bidRepo.saveSession({
        ...(withOrder as NonNullable<typeof withOrder>),
        reservedUntil: new Date(Date.now() - 1_000),
      });

      expect(await harness.bids.expireLapsedReservations()).toBe(0);
      // Sin esta regla, acá se devolvería stock que ya se vendió.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    it('reabrir deja vivas las demás ofertas, que es "ofrecer al segundo"', async () => {
      const session = await openSession();
      const segunda = await harness.bids.submit(OTRO, session.id, { amountMinor: 110_000 });
      const primera = await harness.bids.submit(ANA, session.id, { amountMinor: 150_000 });

      await harness.bids.accept(MARTINA, session.id, primera.bid.id);
      const reserved = await harness.bidRepo.findSession(session.id);
      await harness.bidRepo.saveSession({
        ...(reserved as NonNullable<typeof reserved>),
        reservedUntil: new Date(Date.now() - 1_000),
      });
      await harness.bids.expireLapsedReservations();

      const reopened = await harness.bids.reopen(MARTINA, session.id);
      expect(reopened.status).toBe('open');

      // Y el vendedor puede aceptar la que sigue, sin ningún camino especial.
      const accepted = await harness.bids.accept(MARTINA, session.id, segunda.bid.id);
      expect(String(accepted.session.acceptedBidId)).toBe(String(segunda.bid.id));
      expect(accepted.bid.amountMinor).toBe(110_000);
    });

    it('la venta se marca cuando el pago se aprueba', async () => {
      const { session, order } = await winAndCheckout(120_000);

      await harness.bids.markSold(asOrderId(order.id));

      const sold = await harness.bidRepo.findSession(session.id);
      expect(sold?.status).toBe('sold');
    });

    it('marcar vendido un pedido que no salió de una puja no hace nada', async () => {
      await expect(harness.bids.markSold(asOrderId('ord-inexistente'))).resolves.toBeUndefined();
    });
  });
}
