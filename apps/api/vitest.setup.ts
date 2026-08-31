/**
 * El entorno de las pruebas, fijado **antes** de que se importe un solo módulo.
 *
 * ## Por qué acá y no en un `beforeAll`
 *
 * `infrastructure.module.ts` decide el driver en tiempo de importación:
 *
 * ```ts
 * const persistence = PersistenceModule.register(); // llama a loadEnv()
 * ```
 *
 * Eso corre cuando el archivo de prueba importa `AppModule`, que es **antes**
 * de cualquier `beforeAll`. Un `process.env.DATA_DRIVER = 'memory'` dentro del
 * hook llega tarde: la elección ya está congelada.
 *
 * Costó una lección real. Con un `.env` apuntando a Supabase en la raíz del
 * repositorio, un `pnpm test` local escribió dieciocho transmisiones de prueba
 * en la base desplegada. Las pruebas no fallaron —pasaron todas— y por eso no
 * se notó hasta mirar los datos.
 *
 * `setupFiles` de Vitest corre antes de importar el archivo de prueba, que es
 * el único momento en el que esto funciona.
 */

process.env.NODE_ENV = 'test';

// En memoria, siempre. Ninguna prueba de esta suite necesita un servidor.
process.env.DATA_DRIVER = 'memory';
process.env.CACHE_DRIVER = 'memory';
process.env.STREAMING_PROVIDER = 'mock';
// El proveedor de identidad simulado, bajo el nombre `google`: la suite
// ejercita las rutas de produccion sin hablar con accounts.google.com.
process.env.OAUTH_PROVIDERS = 'fake';

// Borradas, no sobrescritas: si un día algo vuelve a elegir postgres por su
// cuenta, que falle por falta de URL en vez de encontrar una base real.
delete process.env.DATABASE_URL;
delete process.env.DATABASE_CA_CERT;
delete process.env.REDIS_URL;

process.env.JWT_SECRET = 'vitest-only-secret-value-0000000000000';
// El rate limit existe para frenar a un atacante, no a una suite que dispara
// cientos de pedidos por segundo.
process.env.RATE_LIMIT = '100000';
