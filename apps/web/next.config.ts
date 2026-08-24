import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
