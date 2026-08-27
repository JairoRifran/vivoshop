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
 *
 * M05 agrega push. Se agrega **a este** service worker en vez de generar otro:
 * las tres reglas de arriba —la instalación, el caché de la cáscara, y sobre
 * todo el no cachear la API— siguen valiendo, y un archivo generado las
 * perdería sin que nadie lo note hasta que alguien vea un producto agotado
 * como disponible.
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


/* --- Avisos (M05) -------------------------------------------------------- */

/**
 * Un aviso empujado por el servidor.
 *
 * El payload trae todo armado, incluida la URL: este archivo no sabe cómo se
 * construye una ruta de la aplicación, y no tiene por qué. Si el mensaje viene
 * roto o vacío se muestra algo genérico en vez de no mostrar nada — una
 * notificación silenciosa es peor que una imprecisa, porque el navegador puede
 * revocar el permiso de push a un sitio que recibe mensajes y no notifica.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'VivoShop';
  const data = payload.data || {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Un vivo reemplaza al aviso anterior del mismo vivo en vez de apilarse.
      // El servidor ya garantiza un envío por dispositivo; esto es el cinturón
      // por si el mismo mensaje llegara dos veces por el camino.
      tag: data.liveSessionId ? `live:${data.liveSessionId}` : 'vivoshop',
      renotify: false,
      data,
    }),
  );
});

/**
 * Tocar el aviso abre **ese** vivo, no la home.
 *
 * Si la aplicación ya está abierta se reutiliza esa ventana: abrir una segunda
 * pestaña del mismo sitio es la forma más rápida de perder el carrito, la
 * sesión de video o lo que la persona estuviera haciendo.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // `navigate` puede no estar disponible según el navegador; si no está,
        // al menos la ventana quedó al frente.
        if (typeof client.navigate === 'function') await client.navigate(target);
        return;
      }

      await self.clients.openWindow(target);
    })(),
  );
});
