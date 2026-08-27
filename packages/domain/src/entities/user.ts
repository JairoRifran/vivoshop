import type { CountryCode } from '@vivo/config';
import type { UserId } from '../value-objects/identifiers';

/**
 * Roles are additive, never exclusive. One person is a buyer, and may also be
 * a seller. Activating seller mode adds a role to the same account; it never
 * creates a second identity.
 */
export const USER_ROLES = ['buyer', 'seller', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  readonly id: UserId;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly avatarUrl: string | null;
  /**
   * Una linea sobre quien es. Opcional y corta a proposito.
   *
   * En una tienda quien vende es tan parte del producto como lo que vende: es
   * la diferencia entre comprarle a un logo y comprarle a alguien. Corta
   * porque nadie lee un parrafo debajo de una foto de perfil.
   */
  readonly bio: string | null;
  readonly country: CountryCode;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function hasRole(user: Pick<User, 'roles'>, role: UserRole): boolean {
  return user.roles.includes(role);
}

export function isSeller(user: Pick<User, 'roles'>): boolean {
  return hasRole(user, 'seller');
}

export function isActive(user: Pick<User, 'status'>): boolean {
  return user.status === 'active';
}

/** Idempotent: activating seller mode twice leaves the roles untouched. */
export function withRole(roles: readonly UserRole[], role: UserRole): readonly UserRole[] {
  return roles.includes(role) ? roles : [...roles, role];
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
