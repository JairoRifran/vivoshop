import { describe, expect, it } from 'vitest';
import type { DomainError } from '../errors';
import {
  VERIFICATION_STATUSES,
  assertBusinessReviewable,
  assertIdentityReviewable,
  assertVerificationTransition,
  canTransitionVerification,
  isVerified,
  storeCapabilitiesFor,
  type BusinessDetails,
  type IdentityDetails,
  type VerificationStatus,
} from './verification';

const negocio: BusinessDetails = {
  legalName: 'Martina Indumentaria SRL',
  taxId: '210123456789',
  responsibleName: 'Martina Silva',
  responsibleDocument: '1.234.567-8',
  commercialAddress: 'Av. 18 de Julio 1234, Montevideo',
  contactPhone: '099123456',
  contactEmail: 'hola@martinastore.uy',
};

const persona: IdentityDetails = {
  fullName: 'Laura Fernández',
  documentNumber: '4.567.890-1',
  documentType: 'CI',
  phone: '099765432',
  email: 'laura@ejemplo.uy',
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
    // Un rechazo suele ser un dato mal cargado. Empezar de cero castigaría al
    // vendedor por un error de tipeo.
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

describe('el tick es de comercios, no de personas', () => {
  it('la verificación comercial exige identificador tributario', () => {
    // Es lo que separa un comercio formal de una persona que vende. Sin esto,
    // el ✓ estaría afirmando algo que nadie comprobó.
    try {
      assertBusinessReviewable({ ...negocio, taxId: '   ' });
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).code).toBe('VERIFICATION_DETAILS_INCOMPLETE');
      expect((error as DomainError).details).toMatchObject({ missing: ['taxId'] });
    }
  });

  it('exige además datos del negocio, no solo de quien lo atiende', () => {
    // El caso que hay que impedir: otorgar el tick con la sola identidad
    // personal del responsable.
    try {
      assertBusinessReviewable({ ...negocio, legalName: '', commercialAddress: '' });
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).details).toMatchObject({
        missing: ['legalName', 'commercialAddress'],
      });
    }
  });

  it('acepta un comercio con todos sus datos', () => {
    expect(() => assertBusinessReviewable(negocio)).not.toThrow();
  });

  it('la verificación de identidad no pide nada del negocio', () => {
    // Un vendedor particular puede verificar quién es sin tener RUT, razón
    // social ni domicilio comercial.
    expect(() => assertIdentityReviewable(persona)).not.toThrow();
  });

  it('la identidad sí exige documento', () => {
    try {
      assertIdentityReviewable({ ...persona, documentNumber: '' });
      expect.unreachable('debería haber fallado');
    } catch (error) {
      expect((error as DomainError).details).toMatchObject({ missing: ['documentNumber'] });
    }
  });
});

describe('capacidades del tick', () => {
  it('una tienda sin verificar no pierde nada que hoy tenga', () => {
    // La ausencia del tick no transmite desconfianza ni recorta funcionalidad:
    // vender, transmitir y cobrar no dependen de él.
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
