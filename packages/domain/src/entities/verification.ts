import { DomainError } from '../errors';
import type { StoreId, UserId, VerificationId } from '../value-objects/identifiers';

/**
 * Dos verificaciones distintas, que no hay que confundir.
 *
 * ```
 * IdentityVerification  -> confirma quién es una persona.
 *                          Sirve para vendedores particulares.
 *                          NO otorga el tick.
 *
 * BusinessVerification  -> confirma que existe un comercio formal.
 *                          Otorga el ✓ Tienda Verificada.
 * ```
 *
 * La distinción es el corazón de este módulo. El tick dice "VivoShop verificó
 * los datos comerciales de este negocio", y eso exige datos **del negocio**:
 * razón social e identificador tributario, no solo la cédula de quien lo
 * atiende. Otorgarlo con identidad personal a secas sería prometer algo que no
 * se comprobó.
 *
 * ## Lo que ninguna de las dos hace
 *
 * Ser un requisito. VivoShop es para vendedores particulares tanto como para
 * comercios establecidos, y el camino de siempre —crear cuenta, crear tienda,
 * cargar producto, hacer un vivo, vender y cobrar— no pasa por acá en ningún
 * momento. Un vendedor informal no necesita nada de este archivo, y su tienda
 * no lleva ninguna marca negativa por eso: simplemente no lleva tick.
 *
 * Tampoco son una capa de pagos. Una tienda cobra sin estar verificada y puede
 * estar verificada sin cobrar todavía.
 *
 * El tick no se compra. `ProSubscription` es otra cosa y vive aparte.
 */

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Transiciones legales, compartidas por las dos verificaciones.
 *
 * De `rejected` se vuelve a `pending`: un rechazo casi siempre es un dato mal
 * cargado, y obligar a empezar de cero castigaría al vendedor por un error de
 * tipeo. De `verified` se puede volver a `rejected` porque una verificación se
 * revoca si aparece algo que la invalida.
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

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

/** Quién resolvió. Hoy es a mano; mañana puede ser un proceso automático. */
export const VERIFICATION_REVIEWERS = ['manual', 'automated'] as const;
export type VerificationReviewer = (typeof VERIFICATION_REVIEWERS)[number];

/** Lo común a ambas: cuándo se pidió, quién resolvió y por qué. */
interface VerificationRecord {
  readonly id: VerificationId;
  readonly status: VerificationStatus;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewer: VerificationReviewer | null;
  readonly reviewedBy: UserId | null;
  /**
   * Por qué se rechazó. **Interno**: le sirve a soporte para decirle al
   * vendedor qué corregir, y no se expone en ninguna respuesta pública.
   */
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// --- Identidad de una persona ------------------------------------------------

/**
 * Datos de identidad. **Nunca se muestran en público.**
 *
 * Existen para que un vendedor particular pueda ganar confianza —y, más
 * adelante, límites de cobro más altos— sin tener que formalizarse. No dan
 * tick, y eso es deliberado: el tick habla del negocio, no de la persona.
 */
export interface IdentityDetails {
  readonly fullName: string;
  /** Cédula, pasaporte o equivalente. */
  readonly documentNumber: string;
  readonly documentType: string;
  readonly phone: string;
  readonly email: string;
}

export interface IdentityVerification extends VerificationRecord {
  readonly userId: UserId;
  readonly details: IdentityDetails | null;
}

export function assertIdentityReviewable(details: IdentityDetails): void {
  assertPresent(
    [
      ['fullName', details.fullName],
      ['documentNumber', details.documentNumber],
      ['documentType', details.documentType],
      ['phone', details.phone],
      ['email', details.email],
    ],
    'Missing identity details required to review',
  );
}

// --- Comercio formal ---------------------------------------------------------

/**
 * Datos del negocio. **Nunca se muestran en público.**
 *
 * A diferencia de la identidad, acá el identificador tributario **sí es
 * obligatorio**: es lo que distingue a un comercio formal de una persona que
 * vende, y sin él el tick estaría afirmando algo que nadie comprobó. En Uruguay
 * es el RUT.
 *
 * Que sea obligatorio *para el tick* no lo vuelve obligatorio *para vender*.
 * Son dos cosas distintas y conviene no mezclarlas nunca.
 */
export interface BusinessDetails {
  /** Razón social o nombre comercial registrado. */
  readonly legalName: string;
  /** Identificador tributario. En Uruguay, el RUT. Obligatorio para el tick. */
  readonly taxId: string;
  /** Nombre de la persona responsable del negocio. */
  readonly responsibleName: string;
  /** Documento de esa persona. */
  readonly responsibleDocument: string;
  /** Domicilio comercial. */
  readonly commercialAddress: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
}

export interface BusinessVerification extends VerificationRecord {
  readonly storeId: StoreId;
  readonly details: BusinessDetails | null;
}

/**
 * Valida que haya con qué revisar un comercio.
 *
 * El identificador tributario está en la lista a propósito. Si faltara, el
 * badge podría otorgarse con la sola identidad de una persona, que es
 * exactamente lo que no debe pasar: el ✓ dice "comercio verificado".
 */
export function assertBusinessReviewable(details: BusinessDetails): void {
  assertPresent(
    [
      ['legalName', details.legalName],
      ['taxId', details.taxId],
      ['responsibleName', details.responsibleName],
      ['responsibleDocument', details.responsibleDocument],
      ['commercialAddress', details.commercialAddress],
      ['contactPhone', details.contactPhone],
      ['contactEmail', details.contactEmail],
    ],
    'Missing commercial details required to review',
  );
}

function assertPresent(fields: ReadonlyArray<readonly [string, string]>, message: string): void {
  const missing = fields.filter(([, value]) => value.trim().length === 0).map(([field]) => field);
  if (missing.length > 0) {
    throw new DomainError('VERIFICATION_DETAILS_INCOMPLETE', message, { missing });
  }
}

// --- Capacidades -------------------------------------------------------------

/**
 * Qué habilita el tick, preparado pero casi todo apagado.
 *
 * Existe ahora para que las features de más adelante —el filtro de tiendas
 * verificadas, las campañas, el empuje en descubrimiento— se enciendan mirando
 * una capacidad y no repartiendo `status === 'verified'` por media aplicación.
 *
 * Va aparte de `ProSubscription`: son dos ejes distintos, una tienda puede
 * estar verificada sin pagar nada, y el tick nunca se compra.
 */
export interface StoreCapabilities {
  /** Aparece en el filtro "Tiendas verificadas". */
  readonly discoverableAsVerified: boolean;
  /** Elegible para campañas curadas por VivoShop. */
  readonly eligibleForCampaigns: boolean;
  /** Empuje moderado en descubrimiento. Moderado: el tick no compra la portada. */
  readonly discoveryBoost: boolean;
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
 * Deriva las capacidades del estado de la verificación **comercial**.
 *
 * La verificación de identidad no entra: no otorga tick ni beneficios de
 * descubrimiento. Sirve para confianza y, más adelante, para límites de cobro.
 */
export function storeCapabilitiesFor(business: VerificationStatus): StoreCapabilities {
  if (!isVerified(business)) return NO_CAPABILITIES;

  return {
    ...NO_CAPABILITIES,
    discoverableAsVerified: true,
    eligibleForCampaigns: true,
  };
}
