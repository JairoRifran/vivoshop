import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { asUserId } from '../value-objects/identifiers';
import {
  resolveIdentityOutcome,
  safeReturnPath,
  type ProviderProfile,
  type UserIdentity,
} from './identity';

const ANA = asUserId('usr_ana');
const OTRA = asUserId('usr_otra');

const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  providerUserId: 'google-123',
  email: 'ana@vivo.uy',
  emailVerified: true,
  name: 'Ana Pérez',
  avatarUrl: null,
  ...overrides,
});

const identity = (overrides: Partial<UserIdentity> = {}): UserIdentity => ({
  provider: 'google',
  providerUserId: 'google-123',
  userId: ANA,
  email: 'ana@vivo.uy',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('quién es quien vuelve del proveedor', () => {
  it('una identidad ya vinculada simplemente entra', () => {
    const outcome = resolveIdentityOutcome({
      profile: profile(),
      existingIdentity: identity(),
      userIdForEmail: ANA,
    });

    expect(outcome).toEqual({ kind: 'sign_in', userId: ANA });
  });

  it('la identidad manda sobre el email, aunque el email haya cambiado', () => {
    /**
     * Alguien cambió su email en Google. Sigue siendo el mismo `sub`, así que
     * sigue siendo la misma persona y entra a su cuenta de siempre.
     *
     * Si esto buscara por email primero, un cambio de email en Google
     * significaría perder la cuenta acá — con los pedidos adentro.
     */
    const outcome = resolveIdentityOutcome({
      profile: profile({ email: 'ana.nueva@vivo.uy' }),
      existingIdentity: identity(),
      userIdForEmail: null,
    });

    expect(outcome).toEqual({ kind: 'sign_in', userId: ANA });
  });

  it('un email que nadie usa crea una cuenta nueva', () => {
    const outcome = resolveIdentityOutcome({
      profile: profile({ email: 'nueva@vivo.uy' }),
      existingIdentity: null,
      userIdForEmail: null,
    });

    expect(outcome).toEqual({ kind: 'register' });
  });

  it('un email verificado se vincula a la cuenta que ya existe', () => {
    // Ana se registró con contraseña y hoy entra con Google. Es la misma
    // persona y la misma cuenta: una sola, con dos formas de entrar.
    const outcome = resolveIdentityOutcome({
      profile: profile({ emailVerified: true }),
      existingIdentity: null,
      userIdForEmail: ANA,
    });

    expect(outcome).toEqual({ kind: 'link', userId: ANA });
  });

  it('un email SIN verificar sobre una cuenta existente pide la contraseña', () => {
    /**
     * El caso que da sentido a todo el archivo.
     *
     * Si esto devolviera `link`, cualquiera que consiga que un proveedor afirme
     * `ana@vivo.uy` sin comprobarlo se queda con la cuenta de Ana: sus pedidos,
     * su tienda y su cuenta de cobros. Es la forma clásica de robar cuentas en
     * aplicaciones que agregan login social sobre un padrón que ya existe.
     */
    const outcome = resolveIdentityOutcome({
      profile: profile({ emailVerified: false }),
      existingIdentity: null,
      userIdForEmail: ANA,
    });

    expect(outcome).toEqual({ kind: 'needs_password', email: 'ana@vivo.uy' });
  });

  it('sin verificar y sin cuenta previa, registra igual', () => {
    // No hay nada que robar: nadie usa ese email. Exigir verificación acá sería
    // rechazar a alguien sin proteger a nadie.
    const outcome = resolveIdentityOutcome({
      profile: profile({ email: 'nadie@vivo.uy', emailVerified: false }),
      existingIdentity: null,
      userIdForEmail: null,
    });

    expect(outcome).toEqual({ kind: 'register' });
  });

  it('nunca devuelve la cuenta de otra persona', () => {
    // La identidad vinculada gana sobre el email, siempre.
    const outcome = resolveIdentityOutcome({
      profile: profile(),
      existingIdentity: identity({ userId: OTRA }),
      userIdForEmail: ANA,
    });

    expect(outcome).toEqual({ kind: 'sign_in', userId: OTRA });
  });

  it('sin email no se puede decidir nada', () => {
    // Pasa cuando alguien revoca el permiso de email en el proveedor.
    expect(() =>
      resolveIdentityOutcome({
        profile: profile({ email: null }),
        existingIdentity: null,
        userIdForEmail: null,
      }),
    ).toThrow(DomainError);
  });
});

describe('a dónde se vuelve después de entrar', () => {
  it('acepta una ruta del sitio', () => {
    expect(safeReturnPath('/vender/productos')).toBe('/vender/productos');
  });

  it('rechaza un sitio externo', () => {
    // Sin esto, nuestro login es un trampolín de phishing: el enlace sale de
    // nuestro dominio y aterriza en una pantalla que pide la contraseña.
    expect(safeReturnPath('https://sitio-falso.uy')).toBe('/');
  });

  it('rechaza las formas que parecen relativas y no lo son', () => {
    // El navegador lee las dos como absolutas aunque empiecen con barra.
    expect(safeReturnPath('//sitio-falso.uy')).toBe('/');
    expect(safeReturnPath('/\\sitio-falso.uy')).toBe('/');
  });

  it('sin valor usa el destino por defecto', () => {
    expect(safeReturnPath(null, '/perfil')).toBe('/perfil');
    expect(safeReturnPath(undefined)).toBe('/');
  });
});
