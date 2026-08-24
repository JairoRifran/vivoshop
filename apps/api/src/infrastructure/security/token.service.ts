import { Inject, Injectable } from '@nestjs/common';
import type { UserId, UserRole } from '@vivo/domain';
import { asUserId } from '@vivo/domain';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ENV, type AppEnv } from '../../config/env';

export interface AccessTokenClaims {
  readonly userId: UserId;
  readonly roles: readonly UserRole[];
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
 * HS256 access tokens via `jose`, which is pure ESM/WebCrypto and works
 * unchanged on Node and on edge runtimes. Refresh tokens are deliberately out
 * of scope for M01; the seam is a second method on this service.
 */
@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(claims: AccessTokenClaims): Promise<IssuedToken> {
    const expiresAt = new Date(Date.now() + parseDuration(this.env.JWT_EXPIRES_IN));

    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(claims.userId))
      .setIssuedAt()
      .setIssuer('vivo-api')
      .setAudience('vivo-clients')
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    return this.verifyFor(token, 'vivo-clients');
  }

  /** A credential for the WebSocket handshake, and nothing else. */
  async issueRealtime(claims: AccessTokenClaims): Promise<IssuedToken> {
    const expiresAt = new Date(Date.now() + REALTIME_TTL_MS);

    const token = await new SignJWT({ roles: claims.roles })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(claims.userId))
      .setIssuedAt()
      .setIssuer('vivo-api')
      .setAudience(REALTIME_AUDIENCE)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { token, expiresAt };
  }

  async verifyRealtime(token: string): Promise<AccessTokenClaims | null> {
    return this.verifyFor(token, REALTIME_AUDIENCE);
  }

  private async verifyFor(token: string, audience: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: 'vivo-api',
        audience,
      });
      return toClaims(payload);
    } catch {
      return null;
    }
  }
}

function toClaims(payload: JWTPayload): AccessTokenClaims | null {
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  const roles = Array.isArray(payload.roles)
    ? (payload.roles.filter((role): role is UserRole => typeof role === 'string') as UserRole[])
    : [];
  return { userId: asUserId(payload.sub), roles };
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
