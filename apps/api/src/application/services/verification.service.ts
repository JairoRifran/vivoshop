import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  BusinessVerification,
  IdentityVerification,
  Store,
  StoreId,
  UserId,
} from '@vivo/domain';
import {
  asVerificationId,
  assertBusinessReviewable,
  assertIdentityReviewable,
  assertVerificationTransition,
  isVerified,
  storeCapabilitiesFor,
} from '@vivo/domain';
import type { BusinessVerificationRequest, IdentityVerificationRequest } from '@vivo/shared';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { VerificationRepository } from '../ports/payments';
import { VERIFICATION_REPOSITORY } from '../ports/payments';
import type { StoreRepository } from '../ports/repositories';
import { CLOCK, ID_GENERATOR, STORE_REPOSITORY } from '../ports/tokens';

/**
 * Las dos verificaciones, que no son la misma.
 *
 * ```
 * identidad  -> quién es una persona.   No otorga tick.
 * comercio   -> que existe un negocio.  Otorga el ✓.
 * ```
 *
 * Y la regla que gobierna todo el módulo: **nada de acá es un requisito**.
 * Crear cuenta, crear tienda, cargar productos, transmitir, vender y cobrar no
 * pasan por este servicio en ningún momento. Un vendedor particular sin RUT
 * hace el camino completo sin abrir esta pantalla, y su tienda no lleva
 * ninguna marca por eso: simplemente no lleva tick.
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(VERIFICATION_REPOSITORY) private readonly verifications: VerificationRepository,
    @Inject(STORE_REPOSITORY) private readonly stores: StoreRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  // --- Comercio (otorga el ✓) --------------------------------------------

  async businessFor(storeId: StoreId): Promise<BusinessVerification | null> {
    return this.verifications.findBusinessByStore(storeId);
  }

  /**
   * Presenta los datos del negocio para revisión.
   *
   * `assertBusinessReviewable` exige el identificador tributario. Es lo que
   * impide que el tick se otorgue con la sola identidad personal de quien
   * atiende: el ✓ dice "comercio verificado", y afirmarlo sin datos del
   * comercio sería inventar.
   */
  async submitBusiness(
    store: Store,
    input: BusinessVerificationRequest,
  ): Promise<BusinessVerification> {
    const details = {
      legalName: input.legalName,
      taxId: input.taxId,
      responsibleName: input.responsibleName,
      responsibleDocument: input.responsibleDocument,
      commercialAddress: input.commercialAddress,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
    };
    assertBusinessReviewable(details);

    const now = this.clock.now();
    const existing = await this.verifications.findBusinessByStore(store.id);
    // Un rechazo suele ser un dato mal cargado: se vuelve a `pending` en vez
    // de obligar a empezar de cero.
    assertVerificationTransition(existing?.status ?? 'unverified', 'pending');

    return this.verifications.saveBusiness({
      id: existing?.id ?? asVerificationId(this.ids.generate('ver')),
      storeId: store.id,
      status: 'pending',
      details,
      submittedAt: now,
      reviewedAt: null,
      reviewer: null,
      reviewedBy: null,
      rejectionReason: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Resuelve una revisión y sincroniza la copia que vive en la tienda.
   *
   * Las dos escrituras no comparten transacción a propósito: si la segunda
   * fallara, la tienda quedaría sin tick con una verificación aprobada, que es
   * el lado seguro del error —se corrige reintentando y nadie ve un ✓ que no
   * corresponde—. La revisión es manual y de a una; no hay concurrencia que
   * proteger acá.
   */
  async reviewBusiness(input: {
    storeId: StoreId;
    approve: boolean;
    reviewedBy: UserId | null;
    reason?: string;
  }): Promise<BusinessVerification> {
    const existing = await this.verifications.findBusinessByStore(input.storeId);
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No hay verificación pendiente.' });
    }

    const next = input.approve ? 'verified' : 'rejected';
    assertVerificationTransition(existing.status, next);

    const now = this.clock.now();
    const saved = await this.verifications.saveBusiness({
      ...existing,
      status: next,
      reviewedAt: now,
      reviewer: 'manual',
      reviewedBy: input.reviewedBy,
      rejectionReason: input.approve ? null : (input.reason ?? null),
      updatedAt: now,
    });

    const store = await this.stores.findById(input.storeId);
    if (store) await this.stores.update({ ...store, verification: next, updatedAt: now });

    return saved;
  }

  /** Lo que el tick habilita. Casi todo declarado y todavía apagado. */
  capabilities(store: Store) {
    return storeCapabilitiesFor(store.verification);
  }

  isStoreVerified(store: Store): boolean {
    return isVerified(store.verification);
  }

  // --- Identidad (no otorga tick) ------------------------------------------

  async identityFor(userId: UserId): Promise<IdentityVerification | null> {
    return this.verifications.findIdentityByUser(userId);
  }

  /**
   * Verifica quién es una persona. **No** pide RUT, razón social ni domicilio
   * comercial, y no otorga tick: sirve para confianza y, más adelante, para
   * límites de cobro más altos.
   */
  async submitIdentity(
    userId: UserId,
    input: IdentityVerificationRequest,
  ): Promise<IdentityVerification> {
    const details = {
      fullName: input.fullName,
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      phone: input.phone,
      email: input.email,
    };
    assertIdentityReviewable(details);

    const now = this.clock.now();
    const existing = await this.verifications.findIdentityByUser(userId);
    assertVerificationTransition(existing?.status ?? 'unverified', 'pending');

    return this.verifications.saveIdentity({
      id: existing?.id ?? asVerificationId(this.ids.generate('ver')),
      userId,
      status: 'pending',
      details,
      submittedAt: now,
      reviewedAt: null,
      reviewer: null,
      reviewedBy: null,
      rejectionReason: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
}
