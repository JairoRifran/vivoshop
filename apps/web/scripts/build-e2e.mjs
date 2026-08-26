import { spawnSync } from 'node:child_process';

/**
 * Compila la app como la sirve el E2E.
 *
 * Dos variables tienen que estar puestas **durante el build**, no al arrancar
 * el servidor:
 *
 *  - `NEXT_DIST_DIR` separa esta salida de `.next`, así compilar para pruebas
 *    no pisa el `pnpm dev` de quien esté trabajando.
 *  - `NEXT_PUBLIC_API_URL` se incrusta en el bundle del navegador. Pasarla
 *    recién al servidor no serviría: para entonces el valor ya quedó escrito
 *    en el JavaScript que descarga el cliente.
 *
 * Existe como script y no como prefijo en el `package.json` porque `VAR=x cmd`
 * no funciona en PowerShell, y este repositorio se trabaja en Windows.
 */
const result = spawnSync('pnpm', ['exec', 'next', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_PUBLIC_API_URL: 'http://localhost:4100',
  },
});

process.exit(result.status ?? 1);
