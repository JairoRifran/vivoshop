import { defineConfig } from 'vitest/config';

/**
 * Unit tests only. The `e2e` folder belongs to Playwright, and letting Vitest
 * collect it produces confusing "no tests" failures.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.next-e2e/**'],
  },
});
