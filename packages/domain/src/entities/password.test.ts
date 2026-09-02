import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { asUserId } from '../value-objects/identifiers';
import {
  assertCanChangePassword,
  isResetTokenUsable,
  isSessionStillValid,
  PASSWORD_RESET_TTL_SECONDS,
  type PasswordResetToken,
} from './password';

const NOW = new Date('2026-09-01T12:00:00Z');

const token = (overrides: Partial<PasswordResetToken> = {}): PasswordResetToken => ({
  tokenHash: 'huella-del-token',
  userId: asUserId('usr_ana'),
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + PASSWORD_RESET_TTL_SECONDS * 1_000),
  consumedAt: null,
  ...overrides,
});

describe('el permiso para elegir una contraseña nueva', () => {
  it('sirve mientras no venza', () => {
    expect(isResetTokenUsable(token(), NOW)).toBe(true);
  });

  it('deja de servir al vencer', () => {
    const later = new Date(NOW.getTime() + (PASSWORD_RESET_TTL_SECONDS + 1) * 1_000);
    expect(isResetTokenUsable(token(), later)).toBe(false);
  });

  it('no se puede usar dos veces', () => {
    /**
     * Sin esto, alguien que consigue el enlace —del historial, de un buzón
     * compartido, de una captura— puede volver a cambiar la contraseña después
     * de que su dueño ya la cambió, y quedarse con la cuenta.
     */
    expect(isResetTokenUsable(token({ consumedAt: NOW }), NOW)).toBe(false);
  });

  it('vencido Y usado sigue sin servir', () => {
    const later = new Date(NOW.getTime() + 86_400_000);
    expect(isResetTokenUsable(token({ consumedAt: NOW }), later)).toBe(false);
  });
});

describe('qué sesiones sobreviven a un cambio de contraseña', () => {
  const secondsAt = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  it('sin cambios de contraseña, toda sesión vale', () => {
    expect(
      isSessionStillValid({
        issuedAtSeconds: secondsAt('2026-01-01T00:00:00Z'),
        passwordChangedAt: null,
      }),
    ).toBe(true);
  });

  it('una sesión anterior al cambio queda muerta', () => {
    /**
     * El caso que justifica todo: alguien entró a tu cuenta y cambiás la
     * contraseña para echarlo. Si su sesión sobrevive, no lo echaste — sigue
     * adentro hasta que su token venza solo, que acá son siete días.
     */
    expect(
      isSessionStillValid({
        issuedAtSeconds: secondsAt('2026-09-01T11:59:00Z'),
        passwordChangedAt: NOW,
      }),
    ).toBe(false);
  });

  it('una sesión posterior al cambio sigue viva', () => {
    expect(
      isSessionStillValid({
        issuedAtSeconds: secondsAt('2026-09-01T12:00:01Z'),
        passwordChangedAt: NOW,
      }),
    ).toBe(true);
  });

  it('la sesión emitida en el mismo segundo sobrevive', () => {
    // Es la de quien acaba de cambiar la contraseña. Cerrarla la dejaría
    // afuera de su propia cuenta un segundo después de asegurarla, que es la
    // peor manera posible de premiar a alguien por hacer lo correcto.
    expect(
      isSessionStillValid({
        issuedAtSeconds: secondsAt('2026-09-01T12:00:00Z'),
        passwordChangedAt: NOW,
      }),
    ).toBe(true);
  });

  it('ignora los milisegundos, porque el `iat` de un JWT no los tiene', () => {
    // Con `passwordChangedAt` a mitad de segundo, redondear hacia arriba
    // mataría la sesión recién emitida en ese mismo segundo.
    expect(
      isSessionStillValid({
        issuedAtSeconds: secondsAt('2026-09-01T12:00:00Z'),
        passwordChangedAt: new Date('2026-09-01T12:00:00.750Z'),
      }),
    ).toBe(true);
  });
});

describe('qué se pide para cambiar la contraseña', () => {
  it('a quien ya tiene una, se le pide la actual', () => {
    // Sin esto, una sesión robada alcanza para cambiar la contraseña y dejar
    // afuera al dueño de la cuenta.
    expect(() =>
      assertCanChangePassword({ hasPassword: true, currentPasswordProvided: false }),
    ).toThrow(DomainError);
  });

  it('con la actual, pasa', () => {
    expect(() =>
      assertCanChangePassword({ hasPassword: true, currentPasswordProvided: true }),
    ).not.toThrow();
  });

  it('a quien entró con Google y no tiene ninguna, no se le pide nada', () => {
    // Pedirle "la actual" sería pedirle algo que no existe. Y no abre un
    // agujero: quien tiene esa sesión ya podía usar la cuenta, y ponerle una
    // contraseña no le quita a nadie su forma de entrar.
    expect(() =>
      assertCanChangePassword({ hasPassword: false, currentPasswordProvided: false }),
    ).not.toThrow();
  });
});
