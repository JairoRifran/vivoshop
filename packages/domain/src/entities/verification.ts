import { DomainError } from '../errors';
import type { StoreId, UserId, VerificationId } from '../value-objects/identifiers';

/**
 * Verificación comercial de una tienda.
 *
 * ## Lo que este archivo NO hace, y es lo más importante
 *
 * No es un requisito. VivoShop es para vendedores particulares tanto como para
 * comercios establecidos, y el camino de siempre —crear cuenta, crear tienda,
 * cargar producto, hacer un vivo, vender— no pasa por acá en ningún momento.
 * Nadie tiene que declarar un RUT para empezar a vender.
 *
 * Tampoco es una capa de pagos. Una tienda puede cobrar sin estar verificada y
 * puede estar verificada sin cobrar todavía. Se cruzan en la pantalla y en
 * ningún lado más.
 *
 * ## Qué significa el tick
 *
 * Que alguien miró los datos comerciales y los confirmó. Ni más ni menos. El
 * texto que ve el comprador dice exactamente eso, sin prometer que la tienda
 * está al día con la DGI — VivoShop verifica datos, no certifica cumplimiento
 * fiscal, y afirmar lo segundo sería mentir sobre algo que no controla.
 *
 * El tick no se compra. `ProSubscription` es otra cosa y vive aparte.
 */

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Transiciones legales.
 *
 * De `rejected` se vuelve a `pending`: un rechazo casi siempre es un dato mal
 * cargado, y obligar a empezar de cero castigaría al vendedor por un error de
 * tipeo. De `verified` se puede volver a `rejected` porque una verificación se
 * puede revocar si aparece algo que la invalida.
 */
const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  unverified: ['pending'],
  pending: ['verified', 'rejected'],
  verified: ['rejected'],
  rejected: ['pending'],
};

export function canTransitionVerification(
  from: VerificationStatus,
  to: VerificationStatus,
): boolean {
  return VERIFICATION_TRANSITIONS[from].includes(to);
}

export function assertVerificationTransition(
  from: VerificationStatus,
  to: VerificationStatus,
): void {
  if (!canTransitionVerification(from, to)) {
    throw new DomainError(
      'INVALID_VERIFICATION_TRANSITION',
      'Verification cannot change to that status',
      { from, to },
    );
  }
}

/** Quién resolvió la verificación. Hoy es a mano; mañana puede ser automático. */
export const VERIFICATION_REVIEWERS = ['manual', 'automated'] as const;
export type VerificationReviewer = (typeof VERIFICATION_REVIEWERS)[number];

/**
 * Los datos comerciales que se revisan.
 *
 * **Nada de acá se muestra en público.** El comprador ve un tick; los datos
 * viven del lado del servidor y solo los ve quien revisa. Esa separación es el
 * motivo de que sean un objeto aparte y no campos sueltos en `Store`: es más
 * difícil filtrarlos por accidente en un DTO cuando hay que salir a buscarlos.
 */
export interface BusinessDetails {
  /** Razón social o nombre comercial registrado. */
  readonly legalName: string;
  /** Identificador tributario. En Uruguay, el RUT. Opcional a propósito:
   *  un vendedor particular puede pedir verificación de identidad sin tenerlo. */
  readonly taxId: string | null;
  /** Nombre de la persona responsable del negocio. */
  readonly responsibleName: string;
  /** Documento de esa persona. */
  readonly responsibleDocument: string;
  /** Dirección comercial o de contacto. */
  readonly contactAddress: string | null;
  readonly contactPhone: string;
  readonly contactEmail: string;
}

export interface BusinessVerification {
  readonly id: VerificationId;
  readonly storeId: StoreId;
  readonly status: VerificationStatus;
  /** Null mientras la tienda nunca pidió verificarse. */
  readonly details: BusinessDetails | null;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewer: VerificationReviewer | null;
  /** Quién aprobó o rechazó, cuando fue una persona. */
  readonly reviewedBy: UserId | null;
  /**
   * Por qué se rechazó. **Interno**: le sirve a soporte para explicarle al
   * vendedor qué corregir, y no se expone en ninguna respuesta pública.
   */
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

/**
 * Valida que haya lo mínimo para poder revisar.
 *
 * El RUT queda deliberadamente fuera de los obligatorios: se puede verificar la
 * identidad comercial de alguien que factura como particular, y exigirlo dejaría
 * afuera justamente a los vendedores para los que se construyó esto.
 */
export function assertReviewable(details: BusinessDetails): void {
  const missing = (
    [
      ['legalName', details.legalName],
      ['responsibleName', details.responsibleName],
      ['responsibleDocument', details.responsibleDocument],
      ['contactPhone', details.contactPhone],
      ['contactEmail', details.contactEmail],
    ] as const
  )
    .filter(([, value]) => value.trim().length === 0)
    .map(([field]) => field);

  if (missing.length > 0) {
    throw new DomainError(
      'VERIFICATION_DETAILS_INCOMPLETE',
      'Missing commercial details required to review',
      { missing },
    );
  }
}

// --- Capacidades ------------------------------------------------------------

/**
 * Qué habilita el tick, preparado pero todavía apagado.
 *
 * Existe ahora para que las features de más adelante —el filtro de tiendas
 * verificadas, las campañas, el empuje en descubrimiento— se puedan encender
 * mirando una capacidad y no repartiendo `status === 'verified'` por media
 * aplicación.
 *
 * Va aparte de `ProSubscription` porque son dos ejes distintos: una tienda
 * puede estar verificada sin pagar nada, y el tick nunca se compra.
 */
export interface StoreCapabilities {
  /** Aparece en el filtro "Tiendas verificadas". */
  readonly discoverableAsVerified: boolean;
  /** Elegible para campañas curadas por VivoShop. */
  readonly eligibleForCampaigns: boolean;
  /** Empuje moderado en descubrimiento. Moderado: el tick no compra la portada. */
  readonly discoveryBoost: boolean;
  /** Métricas más allá de las básicas. */
  readonly advancedAnalytics: boolean;
  readonly prioritySupport: boolean;
  /** Varias personas operando la misma tienda. */
  readonly teamMembers: boolean;
  /** Habilita políticas de comisión por volumen. */
  readonly volumeCommission: boolean;
}

const NO_CAPABILITIES: StoreCapabilities = {
  discoverableAsVerified: false,
  eligibleForCampaigns: false,
  discoveryBoost: false,
  advancedAnalytics: false,
  prioritySupport: false,
  teamMembers: false,
  volumeCommission: false,
};

/**
 * Deriva las capacidades del estado de verificación.
 *
 * Hoy solo se enciende lo que ya se puede sostener: aparecer en el filtro y ser
 * elegible para campañas. El resto queda declarado en `false` para que
 * habilitarlo después sea cambiar un valor acá y no buscar condicionales por
 * toda la aplicación.
 */
export function storeCapabilitiesFor(status: VerificationStatus): StoreCapabilities {
  if (!isVerified(status)) return NO_CAPABILITIES;

  return {
    ...NO_CAPABILITIES,
    discoverableAsVerified: true,
    eligibleForCampaigns: true,
  };
}
