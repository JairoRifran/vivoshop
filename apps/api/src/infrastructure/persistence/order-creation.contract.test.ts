import { isDomainError } from '@vivo/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOrderRequest } from '@vivo/shared';
import {
  BUYER,
  OTHER_PRODUCT,
  OTHER_VARIANT,
  PRODUCT,
  STORE,
  VARIANT,
  createMemoryHarness,
  createPgliteHarness,
  type DriverHarness,
} from './testing/driver-harness';

/**
 * Order creation, run identically against both persistence drivers.
 *
 * This is the M01.1 safety net. Everything here is about the two things that
 * corrupt a live commerce shop: selling stock that is not there, and charging
 * someone twice because their phone retried a request.
 *
 * Both drivers run the *same* assertions. `DATA_DRIVER=memory` is the default
 * development experience, so a guarantee that only holds in PostgreSQL is not
 * a guarantee — it is a trap waiting for the first developer who reproduces a
 * bug locally and cannot.
 */

let keyCounter = 0;
const nextKey = () => `test-key-${(keyCounter += 1)}-${'0'.repeat(4)}`;

function orderRequest(
  overrides: Partial<CreateOrderRequest> = {},
): CreateOrderRequest {
  return {
    lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 1 }],
    deliveryMethodId: 'uy-pickup',
    paymentMethodId: 'uy-mercadopago',
    installments: 1,
    address: null,
    buyerNote: null,
    liveSessionId: null,
    ...overrides,
  };
}

/** Pulls the domain error code out of whatever the layer wrapped it in. */
function codeOf(error: unknown): string {
  if (isDomainError(error)) return error.code;
  const response = (error as { response?: { code?: string }; getResponse?: () => unknown })
    ?.response;
  if (response?.code) return response.code;
  return String((error as Error)?.message ?? error);
}

function describeDriver(name: string, create: () => Promise<DriverHarness>): void {
  describe(name, () => {
    let harness: DriverHarness;

    beforeAll(async () => {
      harness = await create();
    }, 120_000);

    afterAll(async () => {
      await harness?.dispose();
    });

    beforeEach(async () => {
      // Every scenario states the stock it needs; nothing inherits leftovers.
      await harness.setStock(PRODUCT, VARIANT, 5);
      await harness.setStock(OTHER_PRODUCT, OTHER_VARIANT, 5);
    });

    // --- Happy path ------------------------------------------------------

    it('creates an order and decrements exactly what was bought', async () => {
      const before = await harness.readStock(PRODUCT, VARIANT);

      const order = await harness.checkout.createOrder(
        BUYER,
        STORE,
        orderRequest({ lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 2 }] }),
        nextKey(),
      );

      expect(order.status).toBe('pending_payment');
      expect(order.items).toHaveLength(1);
      expect(order.items[0]?.quantity).toBe(2);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(before - 2);
    });

    it('allows buying exactly the remaining stock', async () => {
      await harness.setStock(PRODUCT, VARIANT, 3);

      const order = await harness.checkout.createOrder(
        BUYER,
        STORE,
        orderRequest({ lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 3 }] }),
        nextKey(),
      );

      expect(order.id).toBeTruthy();
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    it('refuses to sell more than what is left, and writes nothing', async () => {
      await harness.setStock(PRODUCT, VARIANT, 2);
      const ordersBefore = await harness.countOrders();

      await expect(
        harness.checkout.createOrder(
          BUYER,
          STORE,
          orderRequest({ lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 3 }] }),
          nextKey(),
        ),
      ).rejects.toSatisfy((error: unknown) => codeOf(error) === 'OUT_OF_STOCK');

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(2);
      expect(await harness.countOrders()).toBe(ordersBefore);
    });

    // --- Multi-line atomicity -------------------------------------------------

    it('reserves every line of a multi-variant order', async () => {
      await harness.setStock(PRODUCT, VARIANT, 4);
      await harness.setStock(OTHER_PRODUCT, OTHER_VARIANT, 4);

      const order = await harness.checkout.createOrder(
        BUYER,
        STORE,
        orderRequest({
          lines: [
            { productId: PRODUCT, variantId: VARIANT, quantity: 2 },
            { productId: OTHER_PRODUCT, variantId: OTHER_VARIANT, quantity: 1 },
          ],
        }),
        nextKey(),
      );

      expect(order.items).toHaveLength(2);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(2);
      expect(await harness.readStock(OTHER_PRODUCT, OTHER_VARIANT)).toBe(3);
    });

    it('rolls back every line when one of them is short', async () => {
      // The first line is comfortably in stock; the second is not. Nothing at
      // all may be reserved — a partially fulfilled order is worse than none.
      await harness.setStock(PRODUCT, VARIANT, 10);
      await harness.setStock(OTHER_PRODUCT, OTHER_VARIANT, 1);
      const ordersBefore = await harness.countOrders();

      await expect(
        harness.checkout.createOrder(
          BUYER,
          STORE,
          orderRequest({
            lines: [
              { productId: PRODUCT, variantId: VARIANT, quantity: 2 },
              { productId: OTHER_PRODUCT, variantId: OTHER_VARIANT, quantity: 5 },
            ],
          }),
          nextKey(),
        ),
      ).rejects.toSatisfy((error: unknown) => codeOf(error) === 'OUT_OF_STOCK');

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(10);
      expect(await harness.readStock(OTHER_PRODUCT, OTHER_VARIANT)).toBe(1);
      expect(await harness.countOrders()).toBe(ordersBefore);
    });

    it('rejects a line whose variant does not exist, without touching the rest', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);

      await expect(
        harness.checkout.createOrder(
          BUYER,
          STORE,
          orderRequest({
            lines: [{ productId: PRODUCT, variantId: 'no-existe', quantity: 1 }],
          }),
          nextKey(),
        ),
      ).rejects.toSatisfy((error: unknown) =>
        ['VARIANT_NOT_FOUND', 'VARIANT_UNAVAILABLE'].includes(codeOf(error)),
      );

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(5);
    });

    // --- Concurrency ------------------------------------------------------------

    it('two buyers racing for the last unit: one wins, one is told it is gone', async () => {
      await harness.setStock(PRODUCT, VARIANT, 1);
      const ordersBefore = await harness.countOrders();

      // Fired together, not one after the other: the whole point is the
      // interleaving between reading stock and writing it.
      const results = await Promise.allSettled([
        harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey()),
        harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey()),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(codeOf((rejected[0] as PromiseRejectedResult).reason)).toBe('OUT_OF_STOCK');

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
      expect(await harness.countOrders()).toBe(ordersBefore + 1);
    });

    it('five buyers racing for three units: three win, two are told it is gone', async () => {
      await harness.setStock(PRODUCT, VARIANT, 3);
      const ordersBefore = await harness.countOrders();

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey()),
        ),
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(3);
      expect(rejected).toHaveLength(2);
      for (const failure of rejected) {
        expect(codeOf((failure as PromiseRejectedResult).reason)).toBe('OUT_OF_STOCK');
      }

      // The invariant that matters: never negative, never oversold.
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
      expect(await harness.countOrders()).toBe(ordersBefore + 3);
    });

    it('never drives stock below zero under a burst larger than the stock', async () => {
      await harness.setStock(PRODUCT, VARIANT, 2);

      await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey()),
        ),
      );

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(0);
    });

    // --- Idempotency --------------------------------------------------------------

    it('replays the same order for a repeated key, without touching stock again', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);
      const key = nextKey();
      const request = orderRequest();

      const first = await harness.checkout.createOrder(BUYER, STORE, request, key);
      const stockAfterFirst = await harness.readStock(PRODUCT, VARIANT);
      const ordersAfterFirst = await harness.countOrders();

      const second = await harness.checkout.createOrder(BUYER, STORE, request, key);

      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(stockAfterFirst);
      expect(await harness.countOrders()).toBe(ordersAfterFirst);
    });

    it('deduplicates a genuine double tap fired concurrently', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);
      const key = nextKey();
      const request = orderRequest();
      const ordersBefore = await harness.countOrders();

      const results = await Promise.allSettled([
        harness.checkout.createOrder(BUYER, STORE, request, key),
        harness.checkout.createOrder(BUYER, STORE, request, key),
      ]);

      const ids = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result as PromiseFulfilledResult<{ id: string }>).value.id);

      // Both calls may succeed — the second replays — but there is one order.
      expect(new Set(ids).size).toBe(1);
      expect(await harness.countOrders()).toBe(ordersBefore + 1);
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(4);
    });

    it('is insensitive to key order in the payload, which a retry may reserialise', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);
      const key = nextKey();

      const first = await harness.checkout.createOrder(
        BUYER,
        STORE,
        orderRequest({ buyerNote: 'timbre 401' }),
        key,
      );

      // Same values, different property order.
      const reordered: CreateOrderRequest = {
        buyerNote: 'timbre 401',
        liveSessionId: null,
        address: null,
        installments: 1,
        paymentMethodId: 'uy-mercadopago',
        deliveryMethodId: 'uy-pickup',
        lines: [{ quantity: 1, variantId: VARIANT, productId: PRODUCT }],
      };

      const second = await harness.checkout.createOrder(BUYER, STORE, reordered, key);
      expect(second.id).toBe(first.id);
    });

    it('rejects the same key used for a materially different order', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);
      const key = nextKey();

      await harness.checkout.createOrder(BUYER, STORE, orderRequest(), key);
      const ordersAfterFirst = await harness.countOrders();

      await expect(
        harness.checkout.createOrder(
          BUYER,
          STORE,
          orderRequest({ lines: [{ productId: PRODUCT, variantId: VARIANT, quantity: 2 }] }),
          key,
        ),
      ).rejects.toSatisfy((error: unknown) => codeOf(error) === 'IDEMPOTENCY_CONFLICT');

      expect(await harness.countOrders()).toBe(ordersAfterFirst);
    });

    it('frees the key when the attempt failed, so a real retry can succeed', async () => {
      // First attempt fails on stock; the key must not be burned, otherwise a
      // buyer who retries after the seller restocks would be stuck forever.
      await harness.setStock(PRODUCT, VARIANT, 0);
      const key = nextKey();
      const request = orderRequest();

      await expect(
        harness.checkout.createOrder(BUYER, STORE, request, key),
      ).rejects.toSatisfy((error: unknown) => codeOf(error) === 'OUT_OF_STOCK');

      await harness.setStock(PRODUCT, VARIANT, 4);
      const order = await harness.checkout.createOrder(BUYER, STORE, request, key);

      expect(order.status).toBe('pending_payment');
      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(3);
    });

    it('rejects a malformed idempotency key before doing any work', async () => {
      const ordersBefore = await harness.countOrders();

      await expect(
        harness.checkout.createOrder(BUYER, STORE, orderRequest(), 'short'),
      ).rejects.toSatisfy((error: unknown) => codeOf(error) === 'INVALID_IDEMPOTENCY_KEY');

      expect(await harness.countOrders()).toBe(ordersBefore);
    });

    // --- Rollback on an unexpected failure ---------------------------------------

    it('rolls back stock when persisting the order fails', async () => {
      await harness.setStock(PRODUCT, VARIANT, 4);
      const ordersBefore = await harness.countOrders();

      // Fails *after* stock was reserved but before commit — a constraint
      // violation, a dropped connection, a bug. Either the whole purchase
      // happened or none of it did.
      harness.faults.failOnInsertOrder = true;
      try {
        await expect(
          harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey()),
        ).rejects.toThrow();
      } finally {
        harness.faults.failOnInsertOrder = false;
      }

      expect(await harness.readStock(PRODUCT, VARIANT)).toBe(4);
      expect(await harness.countOrders()).toBe(ordersBefore);
    });

    // --- Tax snapshot ----------------------------------------------------------------

    it('freezes the tax rule onto the order and every line', async () => {
      await harness.setStock(PRODUCT, VARIANT, 5);

      const order = await harness.checkout.createOrder(BUYER, STORE, orderRequest(), nextKey());

      expect(order.tax.category).toBe('standard');
      expect(order.tax.rateBps).toBe(2200);
      expect(order.tax.treatment).toBe('included');
      expect(order.taxMinor).toBe(order.tax.amountMinor);
      // Inclusive tax must never inflate what the buyer pays.
      expect(order.taxMinor).toBeLessThan(order.totalMinor);

      for (const item of order.items) {
        expect(item.taxCategory).toBe('standard');
        expect(item.taxRateBps).toBe(2200);
        expect(item.taxAmountMinor).toBeGreaterThan(0);
      }

      // And it survives a round trip through storage.
      const stored = await harness.orders.findById(order.id as never);
      expect(stored?.tax.rateBps).toBe(2200);
      expect(stored?.items[0]?.taxRateBps).toBe(2200);
    });
  });
}

describeDriver('order creation · memory driver', createMemoryHarness);
describeDriver('order creation · postgres driver (pglite)', createPgliteHarness);
