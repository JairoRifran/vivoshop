import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 4100;
const WEB_URL = `http://localhost:${WEB_PORT}`;

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
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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
      reuseExistingServer: !process.env.CI,
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
      },
    },
    {
      command: `pnpm exec next dev --webpack --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
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
