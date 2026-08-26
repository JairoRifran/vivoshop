import type { CurrencyCode } from '@vivo/config';
import type {
  BusinessVerification,
  Dispute,
  IdentityVerification,
  OAuthState,
  Payment,
  SellerPaymentAccount,
} from '@vivo/domain';
import {
  asOrderId,
  asPaymentId,
  asStoreId,
  asUserId,
  asVerificationId,
} from '@vivo/domain';
import type { InferSelectModel } from 'drizzle-orm';
import { SECRET_CONTEXT, type SecretBox } from '../../crypto/secret-box';
import type {
  businessVerifications,
  disputes,
  identityVerifications,
  oauthStates,
  payments,
  sellerPaymentAccounts,
} from './schema';

/**
 * Fila ↔ entidad para todo lo de M03.
 *
 * Archivo aparte del resto de los mappers por una razón práctica: acá viven
 * los tokens del vendedor, y tenerlos en un solo lugar hace visible de un
 * vistazo quién los toca. La entidad los declara; el DTO nunca los ve.
 */

type PaymentRow = InferSelectModel<typeof payments>;
type AccountRow = InferSelectModel<typeof sellerPaymentAccounts>;
type OAuthStateRow = InferSelectModel<typeof oauthStates>;
type BusinessRow = InferSelectModel<typeof businessVerifications>;
type IdentityRow = InferSelectModel<typeof identityVerifications>;
type DisputeRow = InferSelectModel<typeof disputes>;

export function toPayment(row: PaymentRow): Payment {
  return {
    id: asPaymentId(row.id),
    purpose: row.purpose as Payment['purpose'],
    orderId: row.orderId ? asOrderId(row.orderId) : null,
    storeId: asStoreId(row.storeId),
    payerId: asUserId(row.payerId),
    status: row.status as Payment['status'],
    currency: row.currency as CurrencyCode,
    // El reparto se lee tal como se guardó. No se recalcula: lo cobrado ayer
    // tiene que seguir diciendo lo que se cobró ayer.
    split: {
      grossMinor: row.grossMinor,
      commissionMinor: row.commissionMinor,
      commissionRateBps: row.commissionRateBps,
      commissionPolicy: row.commissionPolicy,
      netMinor: row.netMinor,
    },
    installments: row.installments,
    provider: row.provider,
    providerIntentId: row.providerIntentId,
    providerPaymentId: row.providerPaymentId,
    checkoutUrl: row.checkoutUrl,
    failureReason: row.failureReason,
    expiresAt: row.expiresAt,
    approvedAt: row.approvedAt,
    refundedAt: row.refundedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromPayment(payment: Payment) {
  return {
    id: String(payment.id),
    purpose: payment.purpose,
    orderId: payment.orderId ? String(payment.orderId) : null,
    storeId: String(payment.storeId),
    payerId: String(payment.payerId),
    status: payment.status,
    currency: payment.currency,
    grossMinor: payment.split.grossMinor,
    commissionMinor: payment.split.commissionMinor,
    commissionRateBps: payment.split.commissionRateBps,
    commissionPolicy: payment.split.commissionPolicy,
    netMinor: payment.split.netMinor,
    installments: payment.installments,
    provider: payment.provider,
    providerIntentId: payment.providerIntentId,
    providerPaymentId: payment.providerPaymentId,
    checkoutUrl: payment.checkoutUrl,
    failureReason: payment.failureReason,
    expiresAt: payment.expiresAt,
    approvedAt: payment.approvedAt,
    refundedAt: payment.refundedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * La cuenta de cobro, con los tokens descifrados.
 *
 * El cifrado vive exactamente acá, en el borde de la persistencia: adentro del
 * dominio los tokens son texto plano —el proveedor necesita mandarlos en un
 * `Authorization`— y en la base son texto cifrado. Ningún servicio, ninguna
 * entidad y ningún caso de uso se entera, que es la razón de que el cambio
 * quepa en dos funciones.
 */
export function toAccount(row: AccountRow, secrets: SecretBox): SellerPaymentAccount {
  return {
    storeId: asStoreId(row.storeId),
    provider: row.provider,
    status: row.status as SellerPaymentAccount['status'],
    externalAccountId: row.externalAccountId,
    externalAccountLabel: row.externalAccountLabel,
    accessToken: secrets.open(row.accessToken, SECRET_CONTEXT.accessToken),
    refreshToken: secrets.open(row.refreshToken, SECRET_CONTEXT.refreshToken),
    expiresAt: row.expiresAt,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

export function fromAccount(account: SellerPaymentAccount, secrets: SecretBox) {
  return {
    storeId: String(account.storeId),
    provider: account.provider,
    status: account.status,
    externalAccountId: account.externalAccountId,
    externalAccountLabel: account.externalAccountLabel,
    accessToken: secrets.seal(account.accessToken, SECRET_CONTEXT.accessToken),
    refreshToken: secrets.seal(account.refreshToken, SECRET_CONTEXT.refreshToken),
    expiresAt: account.expiresAt,
    connectedAt: account.connectedAt,
    updatedAt: account.updatedAt,
  };
}

export function toOAuthState(row: OAuthStateRow): OAuthState {
  return {
    state: row.state,
    storeId: asStoreId(row.storeId),
    provider: row.provider,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}

export function toBusinessVerification(row: BusinessRow): BusinessVerification {
  return {
    id: asVerificationId(row.id),
    storeId: asStoreId(row.storeId),
    status: row.status as BusinessVerification['status'],
    // Todo o nada: media ficha comercial no es revisable, y un objeto a
    // medias invita a preguntarle campo por campo si está.
    details: row.taxId
      ? {
          legalName: row.legalName ?? '',
          taxId: row.taxId,
          responsibleName: row.responsibleName ?? '',
          responsibleDocument: row.responsibleDocument ?? '',
          commercialAddress: row.commercialAddress ?? '',
          contactPhone: row.contactPhone ?? '',
          contactEmail: row.contactEmail ?? '',
        }
      : null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewer: row.reviewer as BusinessVerification['reviewer'],
    reviewedBy: row.reviewedBy ? asUserId(row.reviewedBy) : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromBusinessVerification(verification: BusinessVerification) {
  return {
    id: String(verification.id),
    storeId: String(verification.storeId),
    status: verification.status,
    legalName: verification.details?.legalName ?? null,
    taxId: verification.details?.taxId ?? null,
    responsibleName: verification.details?.responsibleName ?? null,
    responsibleDocument: verification.details?.responsibleDocument ?? null,
    commercialAddress: verification.details?.commercialAddress ?? null,
    contactPhone: verification.details?.contactPhone ?? null,
    contactEmail: verification.details?.contactEmail ?? null,
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
    reviewer: verification.reviewer,
    reviewedBy: verification.reviewedBy ? String(verification.reviewedBy) : null,
    rejectionReason: verification.rejectionReason,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
  };
}

export function toIdentityVerification(row: IdentityRow): IdentityVerification {
  return {
    id: asVerificationId(row.id),
    userId: asUserId(row.userId),
    status: row.status as IdentityVerification['status'],
    details: row.documentNumber
      ? {
          fullName: row.fullName ?? '',
          documentNumber: row.documentNumber,
          documentType: row.documentType ?? '',
          phone: row.phone ?? '',
          email: row.email ?? '',
        }
      : null,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewer: row.reviewer as IdentityVerification['reviewer'],
    reviewedBy: row.reviewedBy ? asUserId(row.reviewedBy) : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fromIdentityVerification(verification: IdentityVerification) {
  return {
    id: String(verification.id),
    userId: String(verification.userId),
    status: verification.status,
    fullName: verification.details?.fullName ?? null,
    documentNumber: verification.details?.documentNumber ?? null,
    documentType: verification.details?.documentType ?? null,
    phone: verification.details?.phone ?? null,
    email: verification.details?.email ?? null,
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
    reviewer: verification.reviewer,
    reviewedBy: verification.reviewedBy ? String(verification.reviewedBy) : null,
    rejectionReason: verification.rejectionReason,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
  };
}

export function toDispute(row: DisputeRow): Dispute {
  return {
    orderId: asOrderId(row.orderId),
    openedBy: asUserId(row.openedBy),
    reason: row.reason as Dispute['reason'],
    status: row.status as Dispute['status'],
    detail: row.detail,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
  };
}

export function fromDispute(dispute: Dispute) {
  return {
    orderId: String(dispute.orderId),
    openedBy: String(dispute.openedBy),
    reason: dispute.reason,
    status: dispute.status,
    detail: dispute.detail,
    openedAt: dispute.openedAt,
    resolvedAt: dispute.resolvedAt,
  };
}
