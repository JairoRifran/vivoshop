import type { CountryCode, CurrencyCode } from '@vivo/config';
import { DomainError } from '../errors';
import type { StoreId, UserId } from '../value-objects/identifiers';

export const STORE_STATUSES = ['active', 'paused', 'suspended'] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const STORE_CATEGORIES = [
  'moda',
  'belleza',
  'hogar',
  'coleccionables',
  'tecnologia',
  'otros',
] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

/**
 * Per-store knobs. Kept as an explicit object rather than loose columns so a
 * new setting does not require a migration on every consumer.
 */
export interface StoreSettings {
  /** Delivery method ids (from the market config) this store actually offers. */
  readonly deliveryMethodIds: readonly string[];
  /** Free shipping above this gross amount, in minor units. Null disables it. */
  readonly freeShippingThresholdMinor: number | null;
  readonly acceptsReturns: boolean;
  /** Shown on the store page and in checkout as pickup instructions. */
  readonly pickupInstructions: string | null;
  readonly whatsapp: string | null;
}

export interface StoreReputation {
  /** 0 to 500, i.e. 4.8 stars is 480. Integer keeps averages exact. */
  readonly ratingBps: number;
  readonly reviewCount: number;
  readonly salesCount: number;
}

export interface Store {
  readonly id: StoreId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly category: StoreCategory;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly country: CountryCode;
  readonly currency: CurrencyCode;
  readonly city: string | null;
  readonly reputation: StoreReputation;
  readonly followerCount: number;
  readonly status: StoreStatus;
  readonly settings: StoreSettings;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isStoreOpen(store: Pick<Store, 'status'>): boolean {
  return store.status === 'active';
}

export function assertStoreCanSell(store: Pick<Store, 'status' | 'id'>): void {
  if (store.status !== 'active') {
    throw new DomainError('STORE_NOT_ACTIVE', 'Store is not accepting orders', {
      storeId: store.id,
      status: store.status,
    });
  }
}

export function assertOwnership(store: Pick<Store, 'ownerId' | 'id'>, userId: UserId): void {
  if (store.ownerId !== userId) {
    throw new DomainError('NOT_STORE_OWNER', 'User does not own this store', {
      storeId: store.id,
    });
  }
}

/** 480 -> 4.8. Rendering decides how many decimals to show. */
export function ratingStars(reputation: Pick<StoreReputation, 'ratingBps'>): number {
  return Math.round(reputation.ratingBps / 10) / 10;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  deliveryMethodIds: ['uy-home-delivery', 'uy-pickup', 'uy-seller-coordination'],
  freeShippingThresholdMinor: null,
  acceptsReturns: true,
  pickupInstructions: null,
  whatsapp: null,
};
