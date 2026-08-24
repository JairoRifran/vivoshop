/*
 * Vivo service worker.
 *
 * Hand-written rather than generated, because M01 needs exactly three
 * behaviours and nothing else: make the app installable, keep the shell and
 * generated imagery available on a flaky connection, and show a real offline
 * page instead of the browser dinosaur.
 *
 * Explicitly NOT here: caching API responses. A live session's viewer count,
 * stock and prices must never be served from a stale cache — showing someone
 * a sold-out product as available is worse than showing them an error.
 */

const VERSION = 'vivo-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const MEDIA_CACHE = `${VERSION}-media`;
const OFFLINE_URL = '/sin-conexion';

const SHELL_ASSETS = [OFFLINE_URL, '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Generated placeholder imagery is immutable and keyed by URL: cache first.
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // Navigations: network first, offline page as the last resort.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? new Response('Sin conexión', { status: 503 });
      }),
    );
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}
