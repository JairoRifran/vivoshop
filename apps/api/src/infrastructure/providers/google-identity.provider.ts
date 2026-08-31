import { Logger } from '@nestjs/common';
import { DomainError, type ProviderProfile } from '@vivo/domain';
import type { IdentityProvider } from '../../application/ports/infrastructure';
import type { AppEnv } from '../../config/env';

/**
 * Ingresar con Google.
 *
 * OpenID Connect con código de autorización y PKCE. Los extremos están escritos
 * a mano en vez de descubrirlos por `/.well-known/openid-configuration`: son
 * estables desde hace años, y una llamada de descubrimiento en cada arranque
 * agrega una dependencia de red para no enterarse de nada nuevo.
 *
 * ## Por qué no se verifica la firma del `id_token`
 *
 * Parece una omisión y no lo es. El token no viene del navegador: lo trae la
 * respuesta de **nuestra** petición al extremo de tokens de Google, sobre TLS,
 * autenticada con nuestro `client_secret`. Quien controla ese canal ya controla
 * mucho más que una firma. La especificación de OIDC lo dice explícitamente
 * para el flujo de código: el cliente puede confiar en la validación del
 * servidor TLS.
 *
 * Lo que cambiaría eso: aceptar un `id_token` que mande el navegador —por
 * ejemplo, si algún día se agrega el botón "One Tap" del lado del cliente—.
 * Ahí el token viaja por un canal que controla quien lo manda, y **habría que
 * verificar firma, emisor, audiencia y vencimiento** contra las claves
 * públicas de Google. Si alguien agrega eso, este comentario es la advertencia.
 */
export class GoogleIdentityProvider implements IdentityProvider {
  readonly key = 'google' as const;

  private readonly logger = new Logger(GoogleIdentityProvider.name);
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(env: AppEnv) {
    this.clientId = env.GOOGLE_CLIENT_ID ?? '';
    this.clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
  }

  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      // Lo mínimo que sirve. Pedir de más es cómo una pantalla de permisos
      // asusta a alguien que solo quería entrar — y los permisos amplios son
      // los que además exigen revisión de Google.
      scope: 'openid email profile',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      // Sin esto, quien tiene varias cuentas entra siempre con la última que
      // usó, sin poder elegir. Es el reclamo más común del login con Google.
      prompt: 'select_account',
    });

    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<ProviderProfile> {
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: input.codeVerifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new DomainError('IDENTITY_UNAVAILABLE', 'No pudimos verificar tu cuenta de Google.', {
        cause: cause instanceof Error ? cause.message : 'unknown',
      });
    }

    if (!response.ok) {
      // El cuerpo puede traer parte de la credencial; al log va solo el estado.
      this.logger.error(`Google respondió ${response.status} al canjear el código.`);
      throw new DomainError('IDENTITY_UNAVAILABLE', 'No pudimos verificar tu cuenta de Google.', {
        status: response.status,
      });
    }

    const body = (await response.json()) as { id_token?: string };
    const claims = body.id_token ? decodeJwtPayload(body.id_token) : null;
    if (!claims?.sub) {
      throw new DomainError('IDENTITY_UNAVAILABLE', 'No pudimos verificar tu cuenta de Google.', {});
    }

    return {
      providerUserId: claims.sub,
      email: claims.email ?? null,
      // Google lo manda como booleano o como la cadena "true", según el caso.
      // Cualquier otra cosa se lee como **no verificado**: acá el default
      // seguro es el estricto, porque de este campo cuelga si se vincula o no
      // con una cuenta que ya existe.
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    };
  }
}

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

interface GoogleClaims {
  readonly sub?: string;
  readonly email?: string;
  readonly email_verified?: boolean | string;
  readonly name?: string;
  readonly picture?: string;
}

/**
 * Lee el cuerpo del JWT sin verificar la firma.
 *
 * Deliberado, y explicado arriba: el token llegó por nuestra propia conexión
 * TLS con Google. Se llama `decode` y no `verify` justamente para que nadie lo
 * confunda con lo otro.
 */
function decodeJwtPayload(token: string): GoogleClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleClaims;
  } catch {
    return null;
  }
}
