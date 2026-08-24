import { describe, expect, it } from 'vitest';
import { ApiError, humanizeError } from '../errors';
import {
  createLiveRequestSchema,
  createOrderRequestSchema,
  createProductRequestSchema,
  registerRequestSchema,
} from './requests';

describe('register request', () => {
  it('normalizes the email and defaults the country', () => {
    const parsed = registerRequestSchema.parse({
      name: '  Ana Pérez ',
      email: ' ANA@Example.com ',
      password: 'unaClaveSegura',
    });
    expect(parsed.email).toBe('ana@example.com');
    expect(parsed.name).toBe('Ana Pérez');
    expect(parsed.country).toBe('UY');
  });

  it('rejects a short password', () => {
    const result = registerRequestSchema.safeParse({
      name: 'Ana',
      email: 'ana@example.com',
      password: '123',
    });
    expect(result.success).toBe(false);
  });
});

describe('create product request', () => {
  it('requires a price and at least one variant', () => {
    expect(
      createProductRequestSchema.safeParse({
        title: 'Campera Roma',
        basePriceMinor: 0,
        variants: [{}],
      }).success,
    ).toBe(false);

    const ok = createProductRequestSchema.parse({
      title: 'Campera Roma',
      basePriceMinor: 249000,
      variants: [{ stock: 3 }],
    });
    expect(ok.status).toBe('active');
    expect(ok.variants[0]?.active).toBe(true);
    expect(ok.images).toEqual([]);
  });
});

describe('create live request', () => {
  it('accepts an immediate broadcast without a date', () => {
    expect(
      createLiveRequestSchema.safeParse({
        title: 'Nueva colección',
        productIds: ['p1'],
        mode: 'now',
      }).success,
    ).toBe(true);
  });

  it('demands a date when scheduling', () => {
    const result = createLiveRequestSchema.safeParse({
      title: 'Nueva colección',
      productIds: ['p1'],
      mode: 'scheduled',
    });
    expect(result.success).toBe(false);
  });
});

describe('create order request', () => {
  it('defaults the optional checkout fields', () => {
    const parsed = createOrderRequestSchema.parse({
      lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
      deliveryMethodId: 'uy-pickup',
      paymentMethodId: 'uy-mercadopago',
    });
    expect(parsed.installments).toBe(1);
    expect(parsed.address).toBeNull();
    expect(parsed.liveSessionId).toBeNull();
  });

  it('rejects a quantity of zero', () => {
    expect(
      createOrderRequestSchema.safeParse({
        lines: [{ productId: 'p1', variantId: 'v1', quantity: 0 }],
        deliveryMethodId: 'uy-pickup',
        paymentMethodId: 'uy-mercadopago',
      }).success,
    ).toBe(false);
  });
});

describe('error humanizing', () => {
  it('maps known codes to Spanish copy', () => {
    expect(humanizeError(new ApiError(409, { code: 'OUT_OF_STOCK', message: 'x' }))).toContain(
      'agotaron',
    );
  });

  it('falls back for unknown failures', () => {
    expect(humanizeError(new Error('boom'))).toContain('Algo salió mal');
  });
});
