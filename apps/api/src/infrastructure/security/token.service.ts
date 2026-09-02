import { Inject, Injectable } from '@nestjs/common';
import type { UserId, UserRole } from '@vivo/domain';
import { asUserId } from '@vivo/domain';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ENV, type AppEnv } from '../../config/env';
import type { Clock } from '../../application/ports/infrastructure';
import { CLOCK } from '../../application/ports/tokens';

/** Lo que hay que decir para pedir un token. */
export interface AccessTokenClaims {
  readonly userId: UserId;
  readonly roles: readonly UserRole[];
}

/**
 * Lo que vuelve al verificar uno, que es mas de lo que se pidio.
 *
 * Separado a proposito: `issuedAtSeconds` lo pone la firma --`setIssuedAt`--,
 * no quien emite. Pedirselo al que llama seria inventar un dato que el no tiene
 * y que ademas no se le debe creer.
 */
export interface VerifiedClaims extends AccessTokenClaims {
  /**
   * `iat` del token, en segundos desde epoch. Cero si el token no lo trae.
   *
   * Lo usa el guard para descartar sesiones anteriores al ultimo cambio de
   * contrasena. Cero --imposible en la practica, porque siempre se firma con
   * `setIssuedAt`-- se comporta como la sesion mas vieja que existe, asi que un
   * cambio de contrasena la mata. Es el default seguro.
   */
  readonly issuedAtSeconds: number;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * The realtime channel gets its own audience, and a short life.
 *
 * The session token lives in an httpOnly cookie precisely so that browser
 * JavaScript cannot read it — but a WebSocket handshake needs a credential the
 * browser *can* hold. Handing over the session token would give that guarantee
 * away. Instead the server mints a separate token that the REST API refuses
 * (`verify` checks the audience), so the worst a stolen realtime token buys is
 * the ability to chat as that user for half an hour.
 */
const REALTIME_AUDIENCE = 'vivo-realtime';
const REALTIME_TTL_MS = 30 * 60_000;

/**
 * El vale del ingreso social, y por qué la sesión no viaja por la URL.
 *
 * Al volver de Google, la API tiene una sesión y no puede escribirla: la cookie
 * vive en el dominio de la web, que es otro origen. La salida obvia —mandar el
 * JWT de sesión en la query— es la mala: las URLs quedan en el historial del
 * navegador, en la cabecera `Referer` de la primera imagen que cargue esa
 * página, y en los logs de cualquier proxy en el medio. Sería regalar una
 * credencial de siete días en el lugar más público que hay.
 *
 * Así que viaja esto: un vale que dura un minuto, con audiencia propia. La API
 * de sesión lo rechaza —`verify` comprueba la audiencia— así que lo único que
 * se puede hacer con él es canjearlo, del lado del servidor de la web, una vez.
 *
 * Un minuto es lo que tarda una redirección. Lo que queda expuesto es esa
 * ventana, y no siete días.
 */
const EXCHANGE_AUDIENCE = 'vivo-exchange';
const EXCHANGE_TTL_MS = 60_000;

/**
 * HS256 access tokens via `jose`, which is pure ESM/WebCrypto and works
 * unchanged on Node and on edge runtimes. Refresh tokens are deliberately out
 * of scope for M01; the seam is a second method on this service.
 */
@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  /**
   * El reloj es el mismo que usa el resto de la aplicación, y eso importa.
   *
   * Antes esto firmaba con `Date.now()`. Mientras el `iat` de un token solo
   * servía para vencer, daba igual; desde que **decide si una sesión sobrevive
   * a un cambio de contraseña**, comparar dos relojes distintos es comparar
   * cualquier cosa. Con un reloj adelantado en una prueba, el corte quedaba en
   * el futuro y mataba hasta las sesiones recién emitidas.
   */
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(claims: AccessTokenClaims): Promise<IssuedToken> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + parseDuration(this.env.JWT_EXPIRES_IN));

    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(claims.userId))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer('vivo-api')
      .setAudience('vivo-clients')
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verify(token: string): Promise<VerifiedClaims | null> {
    return this.verifyFor(token, 'vivo-clients');
  }

  /** A credential for the WebSocket handshake, and nothing else. */
  async issueRealtime(claims: AccessTokenClaims): Promise<IssuedToken> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + REALTIME_TTL_MS);

    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(claims.userId))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer('vivo-api')
      .setAudience(REALTIME_AUDIENCE)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verifyRealtime(token: string): Promise<VerifiedClaims | null> {
    return this.verifyFor(token, REALTIME_AUDIENCE);
  }

  /** Un vale de un minuto para canjear por la sesión. Ver `EXCHANGE_AUDIENCE`. */
  async issueExchange(claims: AccessTokenClaims): Promise<IssuedToken> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + EXCHANGE_TTL_MS);

    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(claims.userId))
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer('vivo-api')
      .setAudience(EXCHANGE_AUDIENCE)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verifyExchange(token: string): Promise<VerifiedClaims | null> {
    return this.verifyFor(token, EXCHANGE_AUDIENCE);
  }

  private async verifyFor(token: string, audience: string): Promise<VerifiedClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: 'vivo-api',
        audience,
        // El mismo reloj con el que se firma. Sin esto, emitir con el reloj
        // inyectado y verificar contra el del sistema son dos relojes
        // distintos, y un token recien emitido puede nacer vencido.
        currentDate: this.clock.now(),
      });
      return toClaims(payload);
    } catch {
      return null;
    }
  }
}

function toClaims(payload: JWTPayload): VerifiedClaims | null {
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  const roles = Array.isArray(payload.roles)
    ? (payload.roles.filter((role): role is UserRole => typeof role === 'string') as UserRole[])
    : [];
  const issuedAtSeconds = typeof payload.iat === 'number' ? payload.iat : 0;
  return { userId: asUserId(payload.sub), roles, issuedAtSeconds };
}

/** Accepts `900s`, `15m`, `24h`, `7d`. Falls back to seven days. */
export function parseDuration(input: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
  if (!match) return 7 * 86_400_000;

  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * factor;
}
