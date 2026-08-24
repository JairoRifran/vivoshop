import { isPurchasable, totalStock } from '@vivo/domain';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from './dataset';

const NOW = new Date('2026-03-01T20:00:00.000Z');
const dataset = buildDemoDataset({ now: NOW });

describe('demo dataset', () => {
  it('is deterministic for a given clock', () => {
    const again = buildDemoDataset({ now: NOW });
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
  });

  it('populates the app so the first run never looks empty', () => {
    expect(dataset.stores.length).toBeGreaterThanOrEqual(4);
    expect(dataset.products.length).toBeGreaterThanOrEqual(20);
    expect(dataset.orders.length).toBeGreaterThanOrEqual(3);
    expect(dataset.liveMessages.length).toBeGreaterThanOrEqual(10);
  });

  it('covers the four requested store categories', () => {
    const categories = new Set(dataset.stores.map((store) => store.category));
    expect(categories).toContain('moda');
    expect(categories).toContain('belleza');
    expect(categories).toContain('hogar');
    expect(categories).toContain('coleccionables');
  });

  it('has at least one session in every meaningful state', () => {
    const statuses = dataset.liveSessions.map((session) => session.status);
    expect(statuses).toContain('live');
    expect(statuses).toContain('scheduled');
    expect(statuses).toContain('ended');
  });

  it('gives every live session products and every running one a start time', () => {
    for (const session of dataset.liveSessions) {
      expect(session.products.length).toBeGreaterThan(0);
      if (session.status === 'live') expect(session.startedAt).not.toBeNull();
      if (session.status === 'scheduled') expect(session.scheduledAt).not.toBeNull();
    }
  });

  it('points every live product at a real catalogue entry', () => {
    const productIds = new Set(dataset.products.map((product) => String(product.id)));
    for (const session of dataset.liveSessions) {
      for (const entry of session.products) {
        expect(productIds.has(String(entry.productId))).toBe(true);
      }
      if (session.featuredProductId) {
        expect(productIds.has(String(session.featuredProductId))).toBe(true);
      }
    }
  });

  it('links every store to an existing seller account', () => {
    const sellers = new Set(
      dataset.users.filter((user) => user.roles.includes('seller')).map((user) => String(user.id)),
    );
    for (const store of dataset.stores) {
      expect(sellers.has(String(store.ownerId))).toBe(true);
    }
  });

  it('keeps one account that is buyer and seller at once', () => {
    const both = dataset.users.filter(
      (user) => user.roles.includes('buyer') && user.roles.includes('seller'),
    );
    expect(both.length).toBeGreaterThan(0);
  });

  it('ships products that are actually purchasable, plus one paused for the seller UI', () => {
    const active = dataset.products.filter((product) => isPurchasable(product));
    expect(active.length).toBeGreaterThanOrEqual(18);
    expect(dataset.products.some((product) => product.status === 'paused')).toBe(true);
  });

  it('includes a sold-out variant so empty states are reachable', () => {
    expect(
      dataset.products.some((product) => product.variants.some((variant) => variant.stock === 0)),
    ).toBe(true);
    expect(dataset.products.every((product) => totalStock(product) >= 0)).toBe(true);
  });

  it('spreads demo orders across the buyer timeline', () => {
    const statuses = dataset.orders.map((order) => order.status);
    expect(new Set(statuses).size).toBeGreaterThanOrEqual(3);
    expect(statuses).toContain('pending_payment');
    expect(statuses).toContain('delivered');
  });

  it('keeps order totals consistent with their lines', () => {
    for (const order of dataset.orders) {
      const subtotal = order.items.reduce((total, item) => total + item.subtotalMinor, 0);
      expect(order.subtotalMinor).toBe(subtotal);
      expect(order.totalMinor).toBe(subtotal + order.shippingMinor - order.discountMinor);
      expect(order.timeline.at(-1)?.status).toBe(order.status);
    }
  });

  it('requires an address only for shipped orders', () => {
    for (const order of dataset.orders) {
      if (order.delivery.kind === 'shipping') expect(order.delivery.address).not.toBeNull();
      else expect(order.delivery.address).toBeNull();
    }
  });

  it('uses unique emails and slugs', () => {
    expect(new Set(dataset.users.map((user) => user.email)).size).toBe(dataset.users.length);
    expect(new Set(dataset.stores.map((store) => store.slug)).size).toBe(dataset.stores.length);
    expect(new Set(dataset.products.map((product) => String(product.id))).size).toBe(
      dataset.products.length,
    );
  });
});
