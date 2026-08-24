import type { CountryCode, LocaleCode } from './countries';
import type { CurrencyCode } from './currency';
import { getRegions, type Region } from './regions';
import { AR_TAX_RULES, DEFAULT_TAX_CATEGORY, UY_TAX_RULES, type TaxConfig } from './tax';

/** How a buyer receives an order. Real providers arrive in a later milestone. */
export type DeliveryKind = 'shipping' | 'pickup' | 'seller_coordination';

export interface DeliveryMethodConfig {
  readonly id: string;
  readonly kind: DeliveryKind;
  readonly label: string;
  readonly description: string;
  /** Flat fee in minor units. Real quoting arrives with ShippingProvider. */
  readonly flatFeeMinor: number;
  readonly requiresAddress: boolean;
  readonly estimate: string;
}

export interface PaymentMethodConfig {
  readonly id: string;
  /** Maps to a PaymentProvider implementation in the API infrastructure layer. */
  readonly provider: string;
  readonly label: string;
  readonly description: string;
  readonly supportsInstallments: boolean;
  readonly maxInstallments: number;
  /** False while the integration is still mocked. */
  readonly live: boolean;
}

export interface PhoneConfig {
  readonly callingCode: string;
  readonly nationalDigits: readonly number[];
  readonly example: string;
}

export interface AddressConfig {
  readonly regionLabel: string;
  readonly localityLabel: string;
  readonly streetLabel: string;
  readonly postalCodeLabel: string;
  readonly postalCodeRequired: boolean;
  readonly regions: readonly Region[];
}

export interface MarketConfig {
  readonly country: CountryCode;
  readonly name: string;
  readonly locale: LocaleCode;
  readonly currency: CurrencyCode;
  readonly timeZone: string;
  readonly status: 'live' | 'planned';
  readonly phone: PhoneConfig;
  readonly address: AddressConfig;
  readonly tax: TaxConfig;
  readonly delivery: readonly DeliveryMethodConfig[];
  readonly payment: readonly PaymentMethodConfig[];
}

const UY: MarketConfig = {
  country: 'UY',
  name: 'Uruguay',
  locale: 'es-UY',
  currency: 'UYU',
  timeZone: 'America/Montevideo',
  status: 'live',
  phone: { callingCode: '+598', nationalDigits: [8, 9], example: '099 123 456' },
  address: {
    regionLabel: 'Departamento',
    localityLabel: 'Localidad',
    streetLabel: 'Dirección',
    postalCodeLabel: 'Código postal',
    postalCodeRequired: false,
    regions: getRegions('UY'),
  },
  tax: { defaultCategory: DEFAULT_TAX_CATEGORY, rules: UY_TAX_RULES },
  delivery: [
    {
      id: 'uy-home-delivery',
      kind: 'shipping',
      label: 'Envío a domicilio',
      description: 'La tienda despacha el paquete y llega a tu puerta.',
      flatFeeMinor: 19000,
      requiresAddress: true,
      estimate: '2 a 4 días hábiles',
    },
    {
      id: 'uy-pickup',
      kind: 'pickup',
      label: 'Retiro en la tienda',
      description: 'Retirás sin costo en el local del vendedor.',
      flatFeeMinor: 0,
      requiresAddress: false,
      estimate: 'Disponible en 24 h',
    },
    {
      id: 'uy-seller-coordination',
      kind: 'seller_coordination',
      label: 'Coordinar con el vendedor',
      description: 'La tienda te escribe para acordar entrega y costo.',
      flatFeeMinor: 0,
      requiresAddress: false,
      estimate: 'A coordinar',
    },
  ],
  payment: [
    {
      id: 'uy-mercadopago',
      provider: 'mercadopago',
      label: 'Mercado Pago',
      description: 'Tarjeta de débito, crédito o saldo en cuenta.',
      supportsInstallments: true,
      maxInstallments: 12,
      live: false,
    },
    {
      id: 'uy-cash-on-delivery',
      provider: 'cash',
      label: 'Efectivo al recibir',
      description: 'Pagás cuando retirás o cuando te llega el pedido.',
      supportsInstallments: false,
      maxInstallments: 1,
      live: false,
    },
  ],
};

/**
 * Planned markets are intentionally shallow. They exist to prove the core
 * carries no Uruguayan assumptions, and to give expansion work a shape.
 */
const AR: MarketConfig = {
  country: 'AR',
  name: 'Argentina',
  locale: 'es-AR',
  currency: 'ARS',
  timeZone: 'America/Argentina/Buenos_Aires',
  status: 'planned',
  phone: { callingCode: '+54', nationalDigits: [10], example: '11 2345 6789' },
  address: {
    regionLabel: 'Provincia',
    localityLabel: 'Localidad',
    streetLabel: 'Dirección',
    postalCodeLabel: 'Código postal',
    postalCodeRequired: true,
    regions: getRegions('AR'),
  },
  tax: { defaultCategory: DEFAULT_TAX_CATEGORY, rules: AR_TAX_RULES },
  delivery: [
    {
      id: 'ar-home-delivery',
      kind: 'shipping',
      label: 'Envío a domicilio',
      description: 'Envío nacional.',
      flatFeeMinor: 450000,
      requiresAddress: true,
      estimate: '3 a 7 días hábiles',
    },
  ],
  payment: [
    {
      id: 'ar-mercadopago',
      provider: 'mercadopago',
      label: 'Mercado Pago',
      description: 'Tarjeta o saldo en cuenta.',
      supportsInstallments: true,
      maxInstallments: 12,
      live: false,
    },
  ],
};

const MARKETS: Partial<Record<CountryCode, MarketConfig>> = { UY, AR };

export const DEFAULT_COUNTRY: CountryCode = 'UY';

export function getMarket(country: CountryCode = DEFAULT_COUNTRY): MarketConfig {
  return MARKETS[country] ?? UY;
}

export function listMarkets(status?: MarketConfig['status']): readonly MarketConfig[] {
  const all = Object.values(MARKETS).filter((market): market is MarketConfig => Boolean(market));
  return status ? all.filter((market) => market.status === status) : all;
}

export function getDeliveryMethod(
  country: CountryCode,
  id: string,
): DeliveryMethodConfig | undefined {
  return getMarket(country).delivery.find((method) => method.id === id);
}

export function getPaymentMethod(
  country: CountryCode,
  id: string,
): PaymentMethodConfig | undefined {
  return getMarket(country).payment.find((method) => method.id === id);
}
