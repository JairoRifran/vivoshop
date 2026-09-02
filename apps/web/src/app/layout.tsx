import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { ServiceWorker } from '@/components/service-worker';
import './globals.css';

/**
 * Self-hosted at build time by Next, so there is no request to a font CDN on
 * first paint. One variable file covers every weight the design uses.
 */
const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-manrope',
  weight: ['400', '500', '600', '700', '800'],
});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'VivoShop';

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — comprá en vivo`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Mirá transmisiones en vivo de tiendas uruguayas, preguntá en el chat y comprá sin salir del video.',
  applicationName: APP_NAME,
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: APP_NAME },
  formatDetection: { telephone: false },
  /*
   * Declarados acá y no por la convención de archivo de Next (`app/icon.svg`):
   * si existen las dos, `metadata.icons` gana y la otra se ignora en silencio.
   * Un solo lugar, aunque sea el más verboso.
   *
   * El SVG va primero porque escala solo; el PNG queda para quien no lo lea.
   */
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    locale: 'es_UY',
    siteName: APP_NAME,
    title: `${APP_NAME} — comprá en vivo`,
    description: 'Live commerce hecho en Uruguay.',
  },
};

export const viewport: Viewport = {
  themeColor: '#2f6b4f',
  width: 'device-width',
  initialScale: 1,
  // Pinch zoom stays available: disabling it fails WCAG 1.4.4 and helps nobody.
  maximumScale: 5,
  // Lets the layout paint under the notch and the home indicator, which the
  // `pt-safe` / `pb-safe` utilities then pad correctly.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-UY" className={manrope.variable} data-scroll-behavior="smooth">
      <body className="min-h-dvh antialiased">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2 focus:text-surface"
        >
          Saltar al contenido
        </a>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
