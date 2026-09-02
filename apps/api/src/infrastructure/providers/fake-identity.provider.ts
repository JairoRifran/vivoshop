import { DomainError, type AuthProvider, type ProviderProfile } from '@vivo/domain';
import type { IdentityProvider } from '../../application/ports/infrastructure';

/**
 * Un proveedor de identidad de mentira, para desarrollo y para las pruebas.
 *
 * Existe por lo mismo que `MockStreamingProvider` y `FakePaymentProvider`: un
 * clon del repositorio tiene que poder ejercitar el recorrido completo sin que
 * nadie cree credenciales en la consola de Google. Y una suite que dependiera
 * de `accounts.google.com` no probaría lo nuestro: probaría a Google, y
 * fallaría cuando se caiga.
 *
 * **Lo que simula es solo la frontera del proveedor.** El `state`, el PKCE, la
 * decisión de vincular o no, la creación del usuario y la emisión de la sesión
 * son todos reales y se prueban de verdad.
 *
 * En vez de una pantalla de autorización, `authorizationUrl` vuelve derecho al
 * callback con un código que lleva el perfil adentro. Eso permite escribir en
 * una prueba "esta persona vuelve de Google con este email y sin verificar" sin
 * ningún andamiaje.
 */
export class FakeIdentityProvider implements IdentityProvider {
  constructor(readonly key: AuthProvider) {}

  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    // Vuelve al callback sin pasar por ninguna pantalla. El código por defecto
    // describe a alguien nuevo con email verificado, que es el caso normal.
    const code = encodeCode({
      providerUserId: `${this.key}-demo`,
      email: 'demo@vivo.uy',
      emailVerified: true,
      name: 'Persona Demo',
      avatarUrl: null,
    });

    return `${input.redirectUri}?code=${code}&state=${encodeURIComponent(input.state)}`;
  }

  async exchange(input: { code: string }): Promise<ProviderProfile> {
    const profile = decodeCode(input.code);
    if (!profile) {
      throw new DomainError('IDENTITY_UNAVAILABLE', 'No pudimos verificar tu cuenta.', {});
    }
    return profile;
  }
}

/**
 * Arma el código que una prueba le va a pasar al callback.
 *
 * Exportado para que un test pueda decir exactamente quién vuelve del
 * proveedor: con qué email, verificado o no, y con qué identificador. Es lo que
 * permite probar los cuatro desenlaces de `resolveIdentityOutcome` sobre HTTP
 * real en vez de solo en el dominio.
 */
export function encodeCode(profile: ProviderProfile): string {
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
}

function decodeCode(code: string): ProviderProfile | null {
  try {
    const parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as ProviderProfile;
    return parsed.providerUserId ? parsed : null;
  } catch {
    return null;
  }
}
