import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 4100;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

/**
 * Habilita `POST /testing/reset` en la API de pruebas.
 *
 * Va acá y no en un `.env` porque su alcance es exactamente esta corrida: el
 * token nace y muere con el proceso de Playwright. La ruta además exige
 * `NODE_ENV=test` y `DATA_DRIVER=memory`, así que este valor no abre nada en
 * ningún otro lado. Ver `testing.controller.ts`.
 */
const RESET_TOKEN = 'e2e-reset-token-local-only';

export const E2E = { apiUrl: API_URL, resetToken: RESET_TOKEN } as const;

/**
 * End-to-end smoke tests.
 *
 * They run on a dedicated pair of ports so a running `pnpm dev` is never
 * disturbed, and against the in-memory driver so every run starts from the
 * same seeded world with no database to reset.
 *
 * The default project is a phone, because that is the product. A desktop
 * project runs the same buyer journey to catch layout regressions on the
 * wide breakpoint.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  /**
   * Igual en todos lados, a propósito.
   *
   * Antes `forbidOnly` y `retries` dependían de `CI`, así que la suite podía
   * pasar en una máquina y fallar en la otra sin que cambiara una línea de
   * código. Peor: con un reintento, una prueba que dependía del estado que
   * dejó otra pasaba en el segundo intento y la contaminación quedaba
   * invisible. Si algo necesita reintentarse, es que todavía no es
   * determinista.
   */
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    locale: 'es-UY',
    timezoneId: 'America/Montevideo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Grant the camera up front. Chrome's permission prompt is a native
    // dialog Playwright cannot click, and a broadcast test that stalls on it
    // proves nothing.
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        // A synthetic camera and microphone: a green rolling pattern and a
        // beep. This is FAKE MEDIA, not a physical device — a passing test
        // here says the pipeline is wired, never that a real camera worked.
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        /**
         * Memoria compartida en disco en vez del `/dev/shm` por defecto.
         *
         * `bids.spec` abre tres navegadores a la vez —vendedora y dos
         * compradores— y uno se moría con "Page crashed", que no es una
         * aserción que falla sino la pestaña que desaparece. Es el modo de
         * fallar clásico de Chromium cuando la memoria compartida se queda
         * corta, y este flag es la mitigación que recomienda el propio
         * proyecto. No es una espera ni un reintento: cambia dónde reserva
         * memoria el navegador.
         */
        '--disable-dev-shm-usage',
      ],
    },
  },

  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /buyer\.spec\.ts/ },
  ],

  webServer: [
    {
      command: 'node ../api/dist/main.js',
      port: API_PORT,
      /**
       * Nunca se reutiliza un servidor.
       *
       * Con el driver en memoria, reutilizar significa heredar el estado de la
       * corrida anterior. Costó una corrida en falso: un spec fallaba con
       * "Esta puja ya tiene un pedido", que era basura vieja y no una
       * regresión. Arrancar el proceso cuesta segundos; diagnosticar un fallo
       * fantasma cuesta una tarde.
       */
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(API_PORT),
        DATA_DRIVER: 'memory',
        CACHE_DRIVER: 'memory',
        WEB_ORIGIN: WEB_URL,
        JWT_SECRET: 'e2e-only-secret-value-0000000000000000',
        RATE_LIMIT: '100000',
        // The mock provider is what a fresh clone runs, and it is what these
        // tests exercise: no LiveKit account is needed to run the suite.
        STREAMING_PROVIDER: 'mock',
        E2E_RESET_TOKEN: RESET_TOKEN,
        /**
         * Avisos activos en la suite, con claves VAPID de juguete.
         *
         * Con `log` la clave pública es `null` y la pantalla —correctamente—
         * no ofrece el control, así que no habría nada que probar. Estas claves
         * son un par válido generado para esto y no protegen nada: los envíos
         * no salen de la máquina, porque ningún endpoint de prueba existe.
         */
        NOTIFICATION_PROVIDER: 'webpush',
        VAPID_PUBLIC_KEY:
          'BJxKjbfF4qLZ7VjXm2vQ8Y3nJ0hR5tWc9Dg1SsPoIuYtRe4WqAzXcVbNmKlJhGfDsAqWeRtYuIoPaSdFgHjKlZx',
        VAPID_PRIVATE_KEY: 'kZ8pQr3sTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ00',
        VAPID_SUBJECT: 'mailto:e2e@vivoshop.uy',
      },
    },
    {
      /**
       * El build, no el servidor de desarrollo.
       *
       * `next dev` compila cada ruta la primera vez que alguien la visita, y
       * eso puso dos problemas en la suite: era lento —la puja, con tres
       * navegadores, pasaba de tres minutos— y era **variable**, porque un
       * click podía llegar mientras la pantalla todavía se compilaba. Un E2E
       * cuyo resultado depende de cuánto tardó un compilador no prueba el
       * producto.
       *
       * Contra el build, además, se prueba lo que efectivamente se despliega.
       * Compilar cuesta una vez al principio; cada prueba se lo ahorra.
       */
      command: `pnpm exec next start --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        INTERNAL_API_URL: `http://localhost:${API_PORT}`,
        // Own build directory, so this server does not collide with a
        // developer's `pnpm dev` already holding the default lock.
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
