import type { MetadataRoute } from 'next';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Vivo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — comprá en vivo`,
    short_name: APP_NAME,
    description:
      'Mirá transmisiones en vivo de tiendas uruguayas y comprá sin salir del video.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf9f7',
    theme_color: '#14141a',
    lang: 'es-UY',
    dir: 'ltr',
    categories: ['shopping', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Long-press shortcuts on the installed app, straight to the two screens
    // people open on purpose rather than by browsing.
    shortcuts: [
      { name: 'En vivo ahora', url: '/en-vivo', description: 'Transmisiones activas' },
      { name: 'Mis compras', url: '/compras', description: 'Seguimiento de pedidos' },
    ],
  };
}
