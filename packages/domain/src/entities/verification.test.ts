import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  VERIFICATION_STATUSES,
  assertReviewable,
  assertVerificationTransition,
  canTransitionVerification,
  isVerified,
  storeCapabilitiesFor,
  type BusinessDetails,
  type VerificationStatus,
} from './verification';

const detallesCompletos: BusinessDetails = {
  legalName: 'Laura Indumentaria',
  taxId: null,
  responsibleName: 'Laura Fernández',
  responsibleDocument: '1.234.567-8',
  contactAddress: null,
  contactPhone: '099123456',
  contactEmail: 'laura@ejemplo.uy',
};

describe('máquina de estados de la verificación', () => {
  const ALL: readonly VerificationStatus[] = VERIFICATION_STATUSES;

  const LEGAL: ReadonlyArray<readonly [VerificationStatus, VerificationStatus]> = [
    ['unverified', 'pending'],
    ['pending', 'verified'],
    ['pending', 'rejected'],
    ['verified', 'rejected'],
    ['rejected', 'pending'],
  ];

  it('acepta exactamente las transiciones legales', () => {
    const legal = new Set(LEGAL.map(([from, to]) => from + '->' + to));
    for (const from of ALL) {
      for (const to of ALL) {
        expect({ from, to, permitido: canTransitionVerification(from, to) }).toEqual({
          from,
          to,
          permitido: legal.has(from + '->' + to),
        });
      }
    }
  });

  it('deja reintentar después de un rechazo', () => {
    // Un rechazo suele ser un dato mal cargado. Obligar a empezar de cero
    // castigaría al vendedor por un error de tipeo.
    expect(canTransitionVerification('rejected', 'pending')).toBe(true);
  });

  it('permite revocar una verificación otorgada', () => {
    expect(canTransitionVerification('verified', 'rejected')).toBe(true);
  });

  it('no salta de sin verificar a verificada', () => {
    // Siempre hay una revisión en el medio. El tick no se otorga solo.
    expect(canTransitionVerification('unverified', 'verified')).toBe(false);
  });

  it('reporta un código estable', () => {
    try {
      assertVerificationTransition('unverified', 'verified');
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).code).toBe('INVALID_VERIFICATION_TRANSITION');
    }
  });
});

describe('datos comerciales', () => {
  it('acepta un vendedor particular sin RUT', () => {
    // El corazón del principio de vendedores: se puede verificar la identidad
    // comercial de alguien que no está formalizado.
    expect(() => assertReviewable({ ...detallesCompletos, taxId: null })).not.toThrow();
  });

  it('exige lo mínimo para poder revisar', () => {
    try {
      assertReviewable({ ...detallesCompletos, responsibleDocument: '  ' });
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).code).toBe('VERIFICATION_DETAILS_INCOMPLETE');
      expect((error as DomainError).details).toMatchObject({ missing: ['responsibleDocument'] });
    }
  });
});

describe('capacidades del tick', () => {
  it('una tienda sin verificar no pierde nada que hoy tenga', () => {
    // La ausencia del tick no debe transmitir desconfianza ni recortar
    // funcionalidad: vender, transmitir y cobrar no dependen de él.
    const sin = storeCapabilitiesFor('unverified');
    expect(Object.values(sin).every((value) => value === false)).toBe(true);
  });

  it('la verificada gana solo lo que hoy se puede sostener', () => {
    const con = storeCapabilitiesFor('verified');
    expect(con.discoverableAsVerified).toBe(true);
    expect(con.eligibleForCampaigns).toBe(true);
    // Declaradas y todavía apagadas, para encenderlas en un solo lugar.
    expect(con.advancedAnalytics).toBe(false);
    expect(con.teamMembers).toBe(false);
  });

  it('pendiente y rechazada no habilitan nada', () => {
    for (const status of ['pending', 'rejected'] as const) {
      expect(storeCapabilitiesFor(status).discoverableAsVerified).toBe(false);
    }
  });

  it('solo verified cuenta como verificada', () => {
    expect(isVerified('verified')).toBe(true);
    for (const status of ['unverified', 'pending', 'rejected'] as const) {
      expect(isVerified(status)).toBe(false);
    }
  });
});
