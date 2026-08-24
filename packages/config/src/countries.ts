/**
 * Countries the platform knows about. `live` markets are fully configured and
 * selectable; `planned` markets exist so that expansion is a configuration
 * change rather than a refactor.
 */
export const COUNTRY_CODES = ['UY', 'AR', 'CL', 'PY', 'BR'] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

export function isCountryCode(value: string): value is CountryCode {
  return (COUNTRY_CODES as readonly string[]).includes(value);
}

export const LOCALE_CODES = ['es-UY', 'es-AR', 'es-CL', 'es-PY', 'pt-BR'] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];
