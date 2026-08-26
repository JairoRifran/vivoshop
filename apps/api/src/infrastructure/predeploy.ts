import { spawnSync } from 'node:child_process';

/**
 * Todo lo que tiene que pasar antes de que el código nuevo atienda pedidos.
 *
 * ## Por qué un script y no dos comandos encadenados
 *
 * `preDeployCommand` decía `node migrate.js && node encrypt-tokens.js`, y la
 * segunda mitad **nunca se ejecutó**: el host no pasa el comando por un shell,
 * así que `node` recibió el resto como argumentos y los ignoró sin quejarse.
 * Migró el esquema, salió cero, el despliegue quedó verde y los tokens
 * siguieron en texto plano. El intento siguiente —envolver todo en `sh -c`—
 * dependía de suposiciones sobre el shell y las comillas del host, que es más
 * de lo mismo.
 *
 * Un único ejecutable con un único argumento no se puede malinterpretar. El
 * orden y la propagación de errores quedan escritos en TypeScript, donde se
 * pueden leer y probar, en vez de en una cadena de texto de un archivo de
 * configuración.
 *
 * ## El orden importa
 *
 * El esquema primero: cifrar una columna que todavía no existe no tiene
 * sentido. Y si un paso falla, los siguientes no corren y el despliegue se
 * detiene — poner online código que no puede leer lo que hay en la base es
 * peor que no desplegar.
 */
const STEPS: readonly { readonly name: string; readonly script: string }[] = [
  { name: 'esquema', script: 'dist/infrastructure/persistence/drizzle/migrate.js' },
  { name: 'cifrado de credenciales', script: 'dist/infrastructure/crypto/encrypt-tokens.js' },
];

for (const step of STEPS) {
  console.warn(`[predeploy] ${step.name}…`);

  // `process.execPath` en vez de la palabra `node`: es el mismo binario que
  // está corriendo esto, sin depender de qué hay en el PATH del host.
  const result = spawnSync(process.execPath, [step.script], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`[predeploy] "${step.name}" falló. El despliegue se detiene.`);
    process.exit(result.status ?? 1);
  }
}

console.warn('[predeploy] Listo.');
