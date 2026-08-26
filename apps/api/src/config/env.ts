import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadEncryptionKeys } from '../infrastructure/crypto/secret-box';

/**
 * Loads `.env` from the repository root, then from this app, without adding a
 * dependency: Node reads the file natively. Values already present in the real
 * environment always win, so CI and containers stay authoritative.
 */
function loadDotEnvFiles(): void {
  if (typeof process.loadEnvFile !== 'function') return;

  for (const candidate of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../../.env'),
  ]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed .env must not take the process down; validation below
      // will report whatever ends up missing.
    }
    return;
  }
}

loadDotEnvFiles();

/**
 * The process refuses to boot on an invalid environment. Failing at startup
 * with a readable list beats failing on the first request in production.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  DATA_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),

  DATABASE_URL: z.string().optional(),
  /**
   * How to negotiate TLS with Postgres.
   *
   * `auto` is the honest default: plaintext for localhost, verified TLS for
   * anything else. A managed database is always remote, so this turns TLS on
   * without anyone having to remember.
   *
   * `no-verify` encrypts but does not check the certificate chain. Supabase's
   * direct connection presents a certificate signed by their own CA, so
   * without `DATABASE_CA_CERT` this is what makes it connect — at the cost of
   * being open to an active man-in-the-middle. Prefer supplying the CA.
   */
  DATABASE_SSL: z.enum(['auto', 'require', 'no-verify', 'disable']).default('auto'),
  /** PEM of the CA that signed the database certificate. Verified properly. */
  DATABASE_CA_CERT: z.string().optional(),
  REDIS_URL: z.string().optional(),

  /**
   * Defaulted so `pnpm dev` works with no setup at all. The guard below makes
   * shipping this value to production impossible.
   */
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('dev-only-insecure-secret-change-me-please-32chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  /** Comma separated list of browser origins allowed to call the API. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /**
   * Trust `X-Forwarded-For` from one hop.
   *
   * On by default in production because managed hosts always sit behind a load
   * balancer, and off locally because trusting the header when nothing strips
   * it lets a caller pick their own IP and walk past the rate limit.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  RATE_LIMIT: z.coerce.number().int().min(10).default(120),

  // --- Live streaming (M02) --------------------------------------------
  /**
   * `mock` needs no account and no server, which is why it is the default:
   * a clone of this repository has to run without anyone handing over
   * credentials. `livekit` is the real path.
   */
  STREAMING_PROVIDER: z.enum(['mock', 'livekit']).default('mock'),
  /** `ws://` or `wss://`. The management API host is derived from it. */
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  /** Never leaves the server. Never logged. Never sent to a browser. */
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_MAX_PARTICIPANTS: z.coerce.number().int().min(2).default(3000),
  /** Broadcaster credentials outlive a long live; viewers refresh cheaply. */
  LIVEKIT_BROADCASTER_TTL_SECONDS: z.coerce.number().int().min(300).default(6 * 3600),
  LIVEKIT_VIEWER_TTL_SECONDS: z.coerce.number().int().min(300).default(2 * 3600),

  // --- Cobros (M03) -----------------------------------------------------
  /**
   * `fake` no necesita cuenta, credenciales ni internet, que es por qué es el
   * default: un clon del repositorio tiene que arrancar sin que nadie entregue
   * secretos. `mercadopago` es el camino real.
   */
  PAYMENT_PROVIDER: z.enum(['fake', 'mercadopago']).default('fake'),
  /** Identificador publico de la aplicacion. Se puede loguear. */
  MERCADOPAGO_CLIENT_ID: z.string().optional(),
  /** Nunca sale del servidor. Nunca se loguea. Nunca va a un navegador. */
  MERCADOPAGO_CLIENT_SECRET: z.string().optional(),
  /**
   * Credencial de la aplicacion para operaciones que no son de un vendedor.
   *
   * En TEST empieza con `TEST-`; el arranque avisa cuando no lo hace, porque
   * confundir sandbox con produccion es la forma de cobrarle de verdad a
   * alguien que estaba probando.
   */
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  /** Secreto de firma de los webhooks, del panel de Mercado Pago. */
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  /** Base publica de la API, para armar el callback de OAuth y el webhook. */
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),

  // --- Modo Puja (M04) --------------------------------------------------
  /**
   * Cuanto tiene el ganador de una puja para pagar.
   *
   * Vive aca y en `DEFAULT_BID_RESERVATION_SECONDS` del dominio, y en ningun
   * otro lado: es de los valores que se ajustan con datos reales, y buscarlo
   * repartido por el codigo seria el problema.
   */
  BID_RESERVATION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  // --- Cifrado en reposo (M04.1) ----------------------------------------
  /**
   * Clave de cifrado de credenciales de terceros, 32 bytes en base64.
   *
   * Solo por entorno: nunca en el repositorio, nunca derivada de otra cosa que
   * pueda adivinarse. Obligatoria en produccion —sin ella los tokens de los
   * vendedores quedarian en texto plano— y con una clave de desarrollo fuera
   * de produccion para que el camino de cifrado se ejecute igual en las
   * pruebas. Ver `secret-box.ts`.
   */
  ENCRYPTION_KEY: z.string().optional(),
  /**
   * La clave anterior, mientras dure una rotacion. Solo descifra.
   *
   * Poner la nueva en `ENCRYPTION_KEY` y la vieja aca permite rotar sin
   * ventana de indisponibilidad: lo ya escrito se sigue leyendo y lo nuevo se
   * escribe con la nueva.
   */
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

  // --- Pruebas de punta a punta (M04.1) ---------------------------------
  /**
   * Habilita `POST /testing/reset`, que devuelve el mundo al estado sembrado.
   *
   * La ruta existe solo si ademas `NODE_ENV=test` y `DATA_DRIVER=memory`, asi
   * que no hay combinacion de variables que la exponga sobre una base real.
   * Ver `testing.controller.ts`.
   */
  E2E_RESET_TOKEN: z.string().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  readonly corsOrigins: string[];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  /**
   * Qué versión está corriendo: 7 caracteres del commit desplegado, o
   * `development` / `unknown` cuando no hay ninguno.
   *
   * Existe por una pregunta que no se pudo contestar cuando hizo falta. Un
   * deploy subió código que consultaba una columna que la base todavía no
   * tenía, y desde afuera no había forma de saber qué commit estaba vivo:
   * `/health` decía `ok` y no decía nada más. Esto lo vuelve una consulta de
   * un segundo.
   *
   * Es un campo derivado, no la variable. El SHA completo nunca entra a
   * `AppEnv`, así que no hay nada que filtrar por descuido.
   */
  readonly version: string;
}

/** Lo que se muestra del commit. Alcanza para identificarlo sin ser ruido. */
const SHORT_SHA_LENGTH = 7;

/**
 * Deriva la versión desplegada de lo que inyecte el host.
 *
 * El valor se **valida** antes de recortarlo. `/health` es público y sin
 * autenticación: lo que sale de ahí tiene que ser algo que reconocimos como un
 * SHA, no el contenido de una variable de entorno cualquiera.
 */
function deployedVersion(source: NodeJS.ProcessEnv, isProduction: boolean): string {
  const sha = source.RAILWAY_GIT_COMMIT_SHA?.trim() ?? '';
  if (/^[0-9a-f]{7,40}$/i.test(sha)) return sha.slice(0, SHORT_SHA_LENGTH).toLowerCase();

  // Sin SHA hay dos situaciones distintas y conviene no confundirlas: en una
  // máquina de desarrollo es lo normal; en producción significa que el host no
  // lo inyectó, y responder `development` ahí sería afirmar algo falso sobre
  // lo que está corriendo.
  return isProduction ? 'unknown' : 'development';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  // Most hosts (Railway, Render, Fly, Heroku) inject the port as `PORT` and
  // expect the process to listen on it. `API_PORT` stays the name the project
  // uses; this is just the bridge, and an explicit `API_PORT` still wins.
  const normalized: NodeJS.ProcessEnv =
    source.API_PORT === undefined && source.PORT !== undefined
      ? { ...source, API_PORT: source.PORT }
      : source;

  const parsed = envSchema.safeParse(normalized);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  if (env.DATA_DRIVER === 'postgres' && !env.DATABASE_URL) {
    throw new Error('DATA_DRIVER=postgres requires DATABASE_URL');
  }
  if (env.CACHE_DRIVER === 'redis' && !env.REDIS_URL) {
    throw new Error('CACHE_DRIVER=redis requires REDIS_URL');
  }
  if (env.STREAMING_PROVIDER === 'livekit') {
    const missing = (['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const).filter(
      (key) => !env[key],
    );
    if (missing.length > 0) {
      throw new Error(`STREAMING_PROVIDER=livekit requires ${missing.join(', ')}`);
    }
  }
  if (env.PAYMENT_PROVIDER === 'mercadopago') {
    const missing = (
      ['MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_ACCESS_TOKEN'] as const
    ).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`PAYMENT_PROVIDER=mercadopago requires ${missing.join(', ')}`);
    }
  }
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('Refusing to start in production with the development JWT_SECRET');
  }
  // Se valida acá, al arrancar, y no la primera vez que un vendedor conecta su
  // cuenta: un error de configuración tiene que aparecer en el despliegue, no
  // en la cara de quien está intentando cobrar.
  loadEncryptionKeys({
    ...(env.ENCRYPTION_KEY ? { ENCRYPTION_KEY: env.ENCRYPTION_KEY } : {}),
    ...(env.ENCRYPTION_KEY_PREVIOUS
      ? { ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY_PREVIOUS }
      : {}),
    isProduction: env.NODE_ENV === 'production',
  });
  // Una suite de pruebas no tiene nada que hacer contra una base remota. Esto
  // no es teórico: con un `.env` apuntando a Supabase, `pnpm test` escribió
  // datos de prueba en la base desplegada y pasó en verde. Falla ruidosamente
  // en vez de escribir donde no debe.
  if (env.NODE_ENV === 'test' && env.DATA_DRIVER === 'postgres' && !isLocalDatabase(env.DATABASE_URL)) {
    throw new Error(
      'Refusing to run tests against a remote database. ' +
        `DATABASE_URL points at ${hostOf(env.DATABASE_URL)}; tests use DATA_DRIVER=memory.`,
    );
  }

  const isProduction = env.NODE_ENV === 'production';

  return {
    ...env,
    TRUST_PROXY: normalized.TRUST_PROXY === undefined ? isProduction : env.TRUST_PROXY,
    corsOrigins: env.WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction,
    isTest: env.NODE_ENV === 'test',
    // Se lee de `normalized` y no del esquema a propósito: así el SHA completo
    // no forma parte de `AppEnv` y no hay manera de exponerlo sin querer.
    version: deployedVersion(normalized, isProduction),
  };
}

export const ENV = Symbol('APP_ENV');

function hostOf(connectionString: string | undefined): string {
  if (!connectionString) return '(sin URL)';
  try {
    return new URL(connectionString).hostname;
  } catch {
    return '(URL ilegible)';
  }
}

function isLocalDatabase(connectionString: string | undefined): boolean {
  if (!connectionString) return true;
  const host = hostOf(connectionString);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'postgres';
}
