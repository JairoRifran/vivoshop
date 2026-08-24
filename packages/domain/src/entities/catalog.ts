import type { CurrencyCode } from '@vivo/config';
import { DomainError } from '../errors';
import { money, type Money } from '../value-objects/money';
import type { ProductId, StoreId, VariantId } from '../value-objects/identifiers';

export const PRODUCT_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * An option is a dimension of choice ("Talle", "Color", "Sabor", "Formato").
 * Nothing here is fashion specific: a product simply declares its dimensions
 * and every variant pins one value per dimension.
 */
export interface ProductOption {
  readonly name: string;
  readonly values: readonly string[];
}

export interface ProductVariant {
  readonly id: VariantId;
  /** One entry per product option, keyed by option name. Empty for simple products. */
  readonly optionValues: Readonly<Record<string, string>>;
  readonly sku: string | null;
  /** Overrides the product base price when present. */
  readonly priceMinor: number | null;
  readonly stock: number;
  readonly active: boolean;
}

export interface ProductImage {
  readonly url: string;
  readonly alt: string;
}

export interface Product {
  readonly id: ProductId;
  readonly storeId: StoreId;
  readonly title: string;
  readonly description: string;
  readonly basePriceMinor: number;
  /** Strike-through reference price. Null when there is no discount. */
  readonly compareAtPriceMinor: number | null;
  readonly currency: CurrencyCode;
  readonly images: readonly ProductImage[];
  readonly options: readonly ProductOption[];
  readonly variants: readonly ProductVariant[];
  readonly status: ProductStatus;
  /**
   * Key into the market's tax rules. Null means "the market default", which is
   * what almost every product is. Its presence is what stops the rest of the
   * system from assuming one rate per country.
   */
  readonly taxCategory: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Every product owns at least one variant, including simple products with no
 * options. Orders, stock and the live highlight therefore always point at a
 * variant, which removes a whole class of "is it a variant or a product?"
 * branching from the rest of the system.
 */
export function defaultVariant(product: Pick<Product, 'variants'>): ProductVariant | undefined {
  return product.variants.find((variant) => variant.active && variant.stock > 0) ?? product.variants[0];
}

export function findVariant(product: Pick<Product, 'variants'>, variantId: VariantId): ProductVariant {
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  if (!variant) {
    throw new DomainError('VARIANT_NOT_FOUND', 'Variant does not belong to this product', {
      variantId,
    });
  }
  return variant;
}

export function variantPrice(product: Product, variant: ProductVariant): Money {
  return money(variant.priceMinor ?? product.basePriceMinor, product.currency);
}

/** Cheapest active variant, used for "desde $ X" labels on listings. */
export function priceFrom(product: Product): Money {
  const prices = product.variants
    .filter((variant) => variant.active)
    .map((variant) => variant.priceMinor ?? product.basePriceMinor);
  return money(prices.length > 0 ? Math.min(...prices) : product.basePriceMinor, product.currency);
}

export function totalStock(product: Pick<Product, 'variants'>): number {
  return product.variants
    .filter((variant) => variant.active)
    .reduce((total, variant) => total + variant.stock, 0);
}

export function isPurchasable(product: Pick<Product, 'status' | 'variants'>): boolean {
  return product.status === 'active' && totalStock(product) > 0;
}

export function assertPurchasable(product: Pick<Product, 'id' | 'status' | 'variants'>): void {
  if (product.status !== 'active') {
    throw new DomainError('PRODUCT_NOT_PURCHASABLE', 'Product is not published', {
      productId: product.id,
      status: product.status,
    });
  }
}

/** "Negro · M". Empty string for products without options. */
export function variantLabel(variant: Pick<ProductVariant, 'optionValues'>): string {
  return Object.values(variant.optionValues).join(' · ');
}

export function isLowStock(variant: Pick<ProductVariant, 'stock'>, threshold = 5): boolean {
  return variant.stock > 0 && variant.stock <= threshold;
}

export function discountPercent(product: Pick<Product, 'basePriceMinor' | 'compareAtPriceMinor'>): number | null {
  const { basePriceMinor, compareAtPriceMinor } = product;
  if (!compareAtPriceMinor || compareAtPriceMinor <= basePriceMinor) return null;
  return Math.round(((compareAtPriceMinor - basePriceMinor) / compareAtPriceMinor) * 100);
}
