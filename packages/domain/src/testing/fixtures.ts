import type { Product, ProductVariant } from '../entities/catalog';
import type { Store } from '../entities/store';
import { DEFAULT_STORE_SETTINGS } from '../entities/store';
import {
  asProductId,
  asStoreId,
  asUserId,
  asVariantId,
} from '../value-objects/identifiers';

const AT = new Date('2026-03-01T12:00:00.000Z');

export function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: asStoreId('store-1'),
    ownerId: asUserId('user-1'),
    name: 'Plaza Moda',
    slug: 'plaza-moda',
    description: 'Ropa de autor hecha en Montevideo.',
    category: 'moda',
    logoUrl: null,
    coverUrl: null,
    country: 'UY',
    currency: 'UYU',
    city: 'Montevideo',
    reputation: { ratingBps: 480, reviewCount: 124, salesCount: 890 },
    followerCount: 1240,
    verification: 'unverified',
    status: 'active',
    settings: DEFAULT_STORE_SETTINGS,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

export function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: asVariantId('variant-1'),
    optionValues: { Color: 'Negro', Talle: 'M' },
    sku: 'CR-NEG-M',
    priceMinor: null,
    stock: 3,
    active: true,
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: asProductId('product-1'),
    storeId: asStoreId('store-1'),
    title: 'Campera Roma',
    description: 'Campera de gabardina con forro interior.',
    basePriceMinor: 249000,
    compareAtPriceMinor: 299000,
    currency: 'UYU',
    images: [{ url: '/demo/campera-roma.svg', alt: 'Campera Roma' }],
    options: [
      { name: 'Color', values: ['Negro', 'Beige'] },
      { name: 'Talle', values: ['S', 'M', 'L'] },
    ],
    variants: [makeVariant()],
    status: 'active',
    taxCategory: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}
