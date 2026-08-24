import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Nest's DI reads `design:paramtypes`, which esbuild cannot emit. SWC can, so
 * the API test run is compiled with SWC while every other package stays on the
 * default esbuild pipeline.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Corre antes de importar cada archivo de prueba, que es el único momento
    // en el que fijar el driver sirve: `infrastructure.module.ts` lo elige en
    // tiempo de importación. Ver el comentario en vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
