import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Sin esto, el despliegue compila pero revienta en cada pedido.
  //
  // Next traza los archivos que la función serverless necesita empezando por
  // la carpeta de la app. `@vivo/domain`, `@vivo/shared` y `@vivo/config` son
  // paquetes del workspace: viven en `packages/` y llegan acá por symlink. Con
  // la raíz de trazado en `apps/web` ninguno entra en el bundle, y en Vercel
  // eso es `Cannot find module '@vivo/shared'` en tiempo de ejecución.
  //
  // En local no se nota, porque el monorepo entero está en disco.
  outputFileTracingRoot: join(here, '../..'),

  // A separate build directory lets the end-to-end suite run its own dev
  // server while `pnpm dev` is still running: Next allows one dev server per
  // `distDir`, and the lock lives inside it.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // The floating dev badge overlaps the fixed bottom CTA at phone widths and
  // swallows clicks, which makes the end-to-end suite fail on a bug that does
  // not exist in the product. Off for the E2E server only.
  ...(process.env.NEXT_DIST_DIR === '.next-e2e' ? { devIndicators: false as const } : {}),

  // `@vivo/ui` ships TypeScript source rather than a build artefact so that
  // Next owns the JSX and "use client" boundaries. Everything else in the
  // monorepo is compiled to JavaScript before Next sees it.
  transpilePackages: ['@vivo/ui'],

  typedRoutes: false,
  poweredByHeader: false,

  experimental: {
    // Keeps the client bundle small on mid-range Android by only shipping the
    // icon components actually imported.
    optimizePackageImports: ['@vivo/ui'],
  },

  /*
   * `/.well-known/assetlinks.json` lo tiene que servir el dominio raíz con ese
   * nombre exacto: es donde Chrome lo busca y no acepta otro lugar.
   *
   * Va por reescritura y no como archivo en `public/`, por dos razones. La
   * primera es que su contenido depende de la huella de la firma del APK, que
   * no existe hasta que se genera la clave y sale de variables de entorno. La
   * segunda es que las carpetas que empiezan con punto dentro de `public/` han
   * dado problemas según la versión y el host; una ruta no depende de eso.
   */
  async rewrites() {
    return [{ source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
      {
        // The service worker must never be cached, or an update can never ship.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
