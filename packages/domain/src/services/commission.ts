import type { PaymentSplit } from '../entities/payment';

/**
 * Cuánto se queda VivoShop, y por qué.
 *
 * Vive en el dominio y no dentro del proveedor de pagos a propósito. La
 * comisión es una decisión de negocio: cambia por promociones, por volumen o
 * por un acuerdo puntual, y ninguna de esas razones tiene que ver con quién
 * procesa la tarjeta. Si el 3% viviera dentro de `MercadoPagoProvider`,
 * cambiarlo obligaría a tocar el adaptador —y a repetirlo en el siguiente.
 *
 * La tasa se guarda **congelada** en cada pago (`PaymentSplit`). Lo que se
 * cobró ayer sigue diciendo lo que se cobró ayer aunque la política cambie hoy.
 */

/** Puntos básicos: 300 bps = 3%. Enteros para no arrastrar coma flotante. */
export interface CommissionPolicy {
  /** Nombre estable que queda escrito en el pago. */
  readonly name: string;
  readonly rateBps: number;
  /** Para mostrarle al vendedor por qué paga lo que paga. */
  readonly label: string;
}

export const COMMISSION_POLICIES = {
  /** El valor de arranque de VivoShop. */
  standard: { name: 'standard', rateBps: 300, label: 'Comisión estándar 3%' },
  /** Para las primeras tiendas: cobrar cero mientras no hay volumen. */
  launch_promotion: { name: 'launch_promotion', rateBps: 0, label: 'Promoción de lanzamiento' },
  high_volume: { name: 'high_volume', rateBps: 250, label: 'Comisión por volumen 2,5%' },
  custom_agreement: { name: 'custom_agreement', rateBps: 200, label: 'Acuerdo particular 2%' },
} as const satisfies Record<string, CommissionPolicy>;

export type CommissionPolicyName = keyof typeof COMMISSION_POLICIES;

export const DEFAULT_COMMISSION_POLICY: CommissionPolicyName = 'standard';

export function commissionPolicy(name: string | null | undefined): CommissionPolicy {
  if (name && name in COMMISSION_POLICIES) {
    return COMMISSION_POLICIES[name as CommissionPolicyName];
  }
  return COMMISSION_POLICIES[DEFAULT_COMMISSION_POLICY];
}

/**
 * Reparte un monto bruto entre comisión y vendedor.
 *
 * La comisión se redondea **hacia abajo**: ante medio centavo indivisible, la
 * plataforma se queda con menos y el vendedor con más. Es una decisión, no un
 * descuido — el error acumulado nunca debe caer del lado de quien vende.
 *
 * `netMinor` se calcula por resta y no por su propio redondeo, para que
 * comisión y neto sumen exactamente el bruto. Siempre.
 */
export function splitPayment(grossMinor: number, policy: CommissionPolicy): PaymentSplit {
  const commissionMinor = Math.floor((grossMinor * policy.rateBps) / 10_000);

  return {
    grossMinor,
    commissionMinor,
    commissionRateBps: policy.rateBps,
    commissionPolicy: policy.name,
    netMinor: grossMinor - commissionMinor,
  };
}
