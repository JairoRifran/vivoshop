import type { CountryCode } from './countries';

export interface Region {
  /** Stable identifier used in persisted addresses. */
  readonly code: string;
  readonly name: string;
  /** A short, representative list. Free text is always allowed alongside. */
  readonly localities: readonly string[];
}

/**
 * Uruguay's 19 departments. Localities are the most common delivery
 * destinations, not an exhaustive gazetteer: the address form keeps the
 * locality field free-text and uses these as suggestions.
 */
const UY_REGIONS: readonly Region[] = [
  {
    code: 'MO',
    name: 'Montevideo',
    localities: ['Centro', 'Cordón', 'Pocitos', 'Buceo', 'Carrasco', 'Malvín', 'Prado'],
  },
  {
    code: 'CA',
    name: 'Canelones',
    localities: ['Ciudad de la Costa', 'Las Piedras', 'Pando', 'Canelones', 'Atlántida'],
  },
  {
    code: 'MA',
    name: 'Maldonado',
    localities: ['Maldonado', 'Punta del Este', 'San Carlos', 'Piriápolis'],
  },
  { code: 'SA', name: 'Salto', localities: ['Salto', 'Constitución', 'Belén'] },
  { code: 'PA', name: 'Paysandú', localities: ['Paysandú', 'Guichón', 'Quebracho'] },
  {
    code: 'CO',
    name: 'Colonia',
    localities: ['Colonia del Sacramento', 'Carmelo', 'Nueva Helvecia', 'Juan Lacaze'],
  },
  { code: 'SO', name: 'Soriano', localities: ['Mercedes', 'Dolores', 'Cardona'] },
  { code: 'RN', name: 'Río Negro', localities: ['Fray Bentos', 'Young'] },
  { code: 'DU', name: 'Durazno', localities: ['Durazno', 'Sarandí del Yí'] },
  { code: 'FS', name: 'Flores', localities: ['Trinidad'] },
  { code: 'FD', name: 'Florida', localities: ['Florida', 'Sarandí Grande'] },
  { code: 'LA', name: 'Lavalleja', localities: ['Minas', 'José Pedro Varela'] },
  { code: 'RO', name: 'Rocha', localities: ['Rocha', 'Chuy', 'La Paloma', 'Castillos'] },
  { code: 'TT', name: 'Treinta y Tres', localities: ['Treinta y Tres', 'Vergara'] },
  { code: 'CL', name: 'Cerro Largo', localities: ['Melo', 'Río Branco'] },
  { code: 'RV', name: 'Rivera', localities: ['Rivera', 'Tranqueras'] },
  { code: 'TA', name: 'Tacuarembó', localities: ['Tacuarembó', 'Paso de los Toros'] },
  { code: 'AR', name: 'Artigas', localities: ['Artigas', 'Bella Unión'] },
  { code: 'SJ', name: 'San José', localities: ['San José de Mayo', 'Libertad', 'Ciudad del Plata'] },
];

const AR_REGIONS: readonly Region[] = [
  {
    code: 'C',
    name: 'Ciudad Autónoma de Buenos Aires',
    localities: ['Palermo', 'Belgrano', 'Caballito'],
  },
  { code: 'B', name: 'Buenos Aires', localities: ['La Plata', 'Mar del Plata', 'Bahía Blanca'] },
  { code: 'X', name: 'Córdoba', localities: ['Córdoba', 'Villa Carlos Paz'] },
  { code: 'S', name: 'Santa Fe', localities: ['Rosario', 'Santa Fe'] },
];

const REGIONS: Partial<Record<CountryCode, readonly Region[]>> = {
  UY: UY_REGIONS,
  AR: AR_REGIONS,
};

export function getRegions(country: CountryCode): readonly Region[] {
  return REGIONS[country] ?? [];
}

export function findRegion(country: CountryCode, code: string): Region | undefined {
  return getRegions(country).find((region) => region.code === code);
}
