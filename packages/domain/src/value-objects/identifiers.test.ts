import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  assertPositiveQuantity,
  isValidEmail,
  isValidSlug,
  normalizeEmail,
  toSlug,
} from './identifiers';
import { hasRole, initialsOf, isSeller, withRole } from '../entities/user';
import {
  defaultVariant,
  discountPercent,
  findVariant,
  isLowStock,
  isPurchasable,
  priceFrom,
  totalStock,
  variantLabel,
} from '../entities/catalog';
import { makeProduct, makeVariant } from '../testing/fixtures';
import { asVariantId } from './identifiers';
import { ratingStars } from '../entities/store';

describe('slug', () => {
  it('strips accents and punctuation for store URLs', () => {
    expect(toSlug('Plaza Moda')).toBe('plaza-moda');
    expect(toSlug('Café & Té — Montevideo')).toBe('cafe-te-montevideo');
    expect(toSlug('  Doble   espacio  ')).toBe('doble-espacio');
  });

  it('refuses input that cannot become a slug', () => {
    expect(() => toSlug('!!!')).toThrow(DomainError);
  });

  it('validates existing slugs', () => {
    expect(isValidSlug('plaza-moda')).toBe(true);
    expect(isValidSlug('Plaza-Moda')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
  });
});

describe('email', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
  });

  it('rejects malformed addresses', () => {
    expect(() => normalizeEmail('ana@')).toThrow(DomainError);
    expect(isValidEmail('ana@example.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

describe('quantity', () => {
  it('only accepts positive integers', () => {
    expect(assertPositiveQuantity(3)).toBe(3);
    expect(() => assertPositiveQuantity(0)).toThrow(DomainError);
    expect(() => assertPositiveQuantity(1.5)).toThrow(DomainError);
  });
});

describe('user roles', () => {
  it('adds seller mode to the same account, idempotently', () => {
    const roles = withRole(['buyer'], 'seller');
    expect(roles).toEqual(['buyer', 'seller']);
    expect(withRole(roles, 'seller')).toEqual(roles);
    expect(isSeller({ roles })).toBe(true);
    expect(hasRole({ roles }, 'admin')).toBe(false);
  });

  it('keeps buyer capability after becoming a seller', () => {
    expect(hasRole({ roles: withRole(['buyer'], 'seller') }, 'buyer')).toBe(true);
  });

  it('builds avatar initials', () => {
    expect(initialsOf('Martina Silva')).toBe('MS');
    expect(initialsOf('ana')).toBe('A');
  });
});

describe('catalog', () => {
  it('picks the first purchasable variant as the default', () => {
    const product = makeProduct({
      variants: [
        makeVariant({ id: asVariantId('v1'), stock: 0 }),
        makeVariant({ id: asVariantId('v2'), stock: 4 }),
      ],
    });
    expect(defaultVariant(product)?.id).toBe('v2');
  });

  it('finds a variant and rejects a foreign one', () => {
    const product = makeProduct();
    expect(findVariant(product, asVariantId('variant-1')).sku).toBe('CR-NEG-M');
    expect(() => findVariant(product, asVariantId('nope'))).toThrow(DomainError);
  });

  it('labels a variant from its option values', () => {
    expect(variantLabel(makeVariant())).toBe('Negro · M');
    expect(variantLabel(makeVariant({ optionValues: {} }))).toBe('');
  });

  it('reports the cheapest active price for listings', () => {
    const product = makeProduct({
      variants: [
        makeVariant({ id: asVariantId('v1'), priceMinor: 320000 }),
        makeVariant({ id: asVariantId('v2'), priceMinor: 199000 }),
      ],
    });
    expect(priceFrom(product).amountMinor).toBe(199000);
  });

  it('aggregates stock and purchasability', () => {
    const product = makeProduct({
      variants: [
        makeVariant({ id: asVariantId('v1'), stock: 2 }),
        makeVariant({ id: asVariantId('v2'), stock: 5 }),
      ],
    });
    expect(totalStock(product)).toBe(7);
    expect(isPurchasable(product)).toBe(true);
    expect(isPurchasable({ status: 'paused', variants: product.variants })).toBe(false);
    expect(isPurchasable({ status: 'active', variants: [makeVariant({ stock: 0 })] })).toBe(false);
  });

  it('computes the discount badge', () => {
    expect(discountPercent({ basePriceMinor: 249000, compareAtPriceMinor: 299000 })).toBe(17);
    expect(discountPercent({ basePriceMinor: 249000, compareAtPriceMinor: null })).toBeNull();
    expect(discountPercent({ basePriceMinor: 249000, compareAtPriceMinor: 100000 })).toBeNull();
  });

  it('flags low stock without flagging sold out', () => {
    expect(isLowStock({ stock: 3 })).toBe(true);
    expect(isLowStock({ stock: 0 })).toBe(false);
  });
});

describe('store reputation', () => {
  it('renders basis points as stars', () => {
    expect(ratingStars({ ratingBps: 480 })).toBe(4.8);
  });
});
