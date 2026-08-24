import { COUNTRY_CODES, CURRENCY_CODES } from '@vivo/config';
import { z } from 'zod';

/**
 * Dates cross the wire as ISO strings. Parsing with `Date.parse` rather than a
 * zod format helper keeps this stable across zod minor versions.
 */
export const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Fecha inválida' });

export const idSchema = z.string().min(1).max(64);
export const countrySchema = z.enum(COUNTRY_CODES);
export const currencySchema = z.enum(CURRENCY_CODES);

export const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(160)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Email inválido');

/**
 * Twelve characters is not arbitrary: it is long enough to resist casual
 * guessing while short enough that people on a phone keyboard will comply.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Usá al menos 8 caracteres')
  .max(128, 'Máximo 128 caracteres');

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^[+\d\s()-]+$/, 'Teléfono inválido');

/** Money always travels as an integer in minor units. */
export const minorAmountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const quantitySchema = z.number().int().min(1).max(99);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
