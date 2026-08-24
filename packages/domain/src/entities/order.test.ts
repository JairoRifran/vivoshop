import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  ORDER_STATUSES,
  ORDER_TIMELINE,
  assertDeliveryAddress,
  assertOrderTransition,
  canTransitionOrder,
  isOrderCancellableByBuyer,
  isOrderFinal,
  nextOrderStatuses,
  timelineIndex,
} from './order';

describe('order status machine', () => {
  it('walks the happy path', () => {
    expect(canTransitionOrder('pending_payment', 'paid')).toBe(true);
    expect(canTransitionOrder('paid', 'preparing')).toBe(true);
    expect(canTransitionOrder('preparing', 'shipped')).toBe(true);
    expect(canTransitionOrder('shipped', 'delivered')).toBe(true);
  });

  it('never skips stages or moves backwards', () => {
    expect(canTransitionOrder('pending_payment', 'shipped')).toBe(false);
    expect(canTransitionOrder('delivered', 'shipped')).toBe(false);
    expect(canTransitionOrder('paid', 'pending_payment')).toBe(false);
  });

  it('cannot cancel an order already shipped', () => {
    expect(canTransitionOrder('shipped', 'cancelled')).toBe(false);
    expect(() => assertOrderTransition('shipped', 'cancelled')).toThrow(DomainError);
  });

  it('treats completed and cancelled as terminal', () => {
    // `delivered` dejó de ser el final en M03: llegó, pero todavía puede
    // reclamarse. `completed` es el momento en que la compra se da por buena
    // y, si el proveedor lo soporta, se libera la plata.
    expect(isOrderFinal('completed')).toBe(true);
    expect(isOrderFinal('cancelled')).toBe(true);
    expect(isOrderFinal('delivered')).toBe(false);
    expect(isOrderFinal('paid')).toBe(false);
  });

  it('exposes the legal next steps for the seller UI', () => {
    expect(nextOrderStatuses('paid')).toEqual(['preparing', 'cancelled']);
    expect(nextOrderStatuses('delivered')).toEqual(['completed']);
    expect(nextOrderStatuses('completed')).toEqual([]);
  });

  it('covers every status in the machine', () => {
    for (const status of ORDER_STATUSES) {
      expect(() => nextOrderStatuses(status)).not.toThrow();
    }
  });

  it('orders the buyer timeline without the cancelled branch', () => {
    expect(ORDER_TIMELINE).not.toContain('cancelled');
    expect(timelineIndex('preparing')).toBe(2);
    expect(timelineIndex('cancelled')).toBe(-1);
  });

  it('lets a buyer cancel only before the store ships', () => {
    expect(isOrderCancellableByBuyer({ status: 'pending_payment' })).toBe(true);
    expect(isOrderCancellableByBuyer({ status: 'paid' })).toBe(true);
    expect(isOrderCancellableByBuyer({ status: 'shipped' })).toBe(false);
  });
});

describe('delivery', () => {
  it('requires an address when shipping', () => {
    expect(() => assertDeliveryAddress({ kind: 'shipping', address: null })).toThrow(DomainError);
  });

  it('does not require an address for pickup or coordination', () => {
    expect(() => assertDeliveryAddress({ kind: 'pickup', address: null })).not.toThrow();
    expect(() =>
      assertDeliveryAddress({ kind: 'seller_coordination', address: null }),
    ).not.toThrow();
  });
});
