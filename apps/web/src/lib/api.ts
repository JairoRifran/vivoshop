import 'server-only';
import { createApiClient, isApiError, type ApiClient, type UserDto } from '@vivo/shared';
import { cache } from 'react';
import { readToken } from './session';

const BASE_URL =
  process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Server-side API client.
 *
 * Every read in this app happens in a Server Component, which keeps the
 * client bundle free of data-fetching code and means the token never leaves
 * the server. The same `createApiClient` from `@vivo/shared` will back the
 * Expo app, so the contract cannot drift between platforms.
 */
export async function api(): Promise<ApiClient> {
  const token = await readToken();
  return createApiClient({
    baseUrl: BASE_URL,
    getToken: () => token,
    // Live data must never be served stale; individual calls opt into caching.
    defaultInit: { cache: 'no-store' },
  });
}

/**
 * Current user for the request. `cache` dedupes it across every component in
 * one render pass, so a page with a header, a nav and a body makes one call.
 */
export const getCurrentUser = cache(async (): Promise<UserDto | null> => {
  const token = await readToken();
  if (!token) return null;

  try {
    const client = await api();
    return await client.auth.me();
  } catch (error) {
    // An expired token is a normal state, not an error worth surfacing.
    if (isApiError(error) && (error.isUnauthorized || error.isOffline)) return null;
    throw error;
  }
});

/** Reads that may fail without taking the page down (a rail, a side panel). */
export async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
