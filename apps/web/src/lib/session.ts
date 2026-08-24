import 'server-only';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'vivo_session';

/**
 * The access token lives in an httpOnly cookie and is never handed to client
 * JavaScript. Server Components read it to call the API; Server Actions write
 * it. A compromised third-party script therefore cannot read a session.
 */
export async function readToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeToken(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
