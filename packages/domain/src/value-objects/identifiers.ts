import { DomainError } from '../errors';

/**
 * Branded ids. They are strings at runtime, but the compiler refuses to pass a
 * StoreId where a ProductId is expected, which is the single most common
 * copy-paste bug in a system with this many relations.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type StoreId = Brand<string, 'StoreId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type VariantId = Brand<string, 'VariantId'>;
export type LiveSessionId = Brand<string, 'LiveSessionId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type AddressId = Brand<string, 'AddressId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type VerificationId = Brand<string, 'VerificationId'>;

export const asUserId = (value: string): UserId => value as UserId;
export const asStoreId = (value: string): StoreId => value as StoreId;
export const asProductId = (value: string): ProductId => value as ProductId;
export const asVariantId = (value: string): VariantId => value as VariantId;
export const asLiveSessionId = (value: string): LiveSessionId => value as LiveSessionId;
export const asOrderId = (value: string): OrderId => value as OrderId;
export const asMessageId = (value: string): MessageId => value as MessageId;
export const asAddressId = (value: string): AddressId => value as AddressId;
export const asPaymentId = (value: string): PaymentId => value as PaymentId;
export const asVerificationId = (value: string): VerificationId => value as VerificationId;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Store URLs are `/tienda/<slug>`, so the slug is part of the public contract. */
export function toSlug(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

  if (!SLUG_PATTERN.test(slug)) {
    throw new DomainError('INVALID_SLUG', 'Value cannot be converted into a usable slug', {
      input,
    });
  }
  return slug;
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value.length >= 2 && value.length <= 60;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new DomainError('INVALID_EMAIL', 'Email address is not valid', { input });
  }
  return email;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim().toLowerCase());
}

export function assertPositiveQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new DomainError('INVALID_QUANTITY', 'Quantity must be a positive integer', { quantity });
  }
  return quantity;
}
