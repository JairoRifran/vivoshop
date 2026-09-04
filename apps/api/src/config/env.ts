import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_CHECKOUT_RESERVATION_SECONDS } from '@vivo/domain';
import { loadEncryptionKeys } from '../infrastructure/crypto/secret-box';

/** La raíz del monorepo, subiendo desde este archivo hasta `pnpm-workspace.yaml`. */
function workspaceEnvFile(): string | null {
  let directory = __dirname;
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(resolve(directory, 'pnpm-workspace.yaml'))) {
      return resolve(directory, '.env');
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

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
    // Y por último, la raíz del workspace buscada desde este archivo.
    //
    // Los tres candidatos de arriba salen de `process.cwd()`, que sirve mientras
    // el proceso arranque desde adentro del repositorio —lo que hace `pnpm dev`,
    // con cwd en `apps/api`—. Pero `node apps/api/dist/main.js` lanzado desde un
    // directorio de más arriba es una forma perfectamente normal de arrancar un
    // servicio, y ahí ninguno de los tres acierta: el `.env` se ignora entero y
    // en silencio, y lo que sea que tenga adentro parece no tener efecto.
    workspaceEnvFile(),
  ]) {
    if (!candidate) continue;
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
  /**
   * Le da el rol `admin` a esta cuenta al sembrar, para poder abrir `/admin` en
   * desarrollo.
   *
   * Existe porque `pnpm db:grant-admin` escribe en PostgreSQL y el desarrollo
   * corre con `DATA_DRIVER=memory`, que se rearma en cada arranque: sin esto no
   * hay ninguna forma de entrar al panel local.
   *
   * Es una segunda via de privilegio, que es exactamente lo que M13 dice que
   * hay que evitar. Se banca solo porque esta cerrada por los dos lados:
   * `loadEnv` la rechaza si `NODE_ENV=production` o si el driver es `postgres`,
   * y el unico codigo que la lee es el arranque del driver en memoria. Contra
   * una base de verdad no hace nada aunque este puesta.
   */
  DEV_ADMIN_EMAIL: z.string().email().optional(),
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
  LIVEKIT_BROADCASTER_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .default(6 * 3600),
  LIVEKIT_VIEWER_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .default(2 * 3600),

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
  /**
   * Cuanto se le guarda el stock a un checkout que nadie paga.
   *
   * Sin esto la reserva es eterna: quien abre el checkout y se va deja el
   * producto trabado para siempre. Paso en produccion --siete pedidos
   * reteniendo siete unidades-- y por eso existe.
   *
   * Vive aca y en `DEFAULT_CHECKOUT_RESERVATION_SECONDS` del dominio, y en
   * ningun otro lado. Si el proveedor pone su propia fecha de vencimiento,
   * gana la del proveedor: es la que ve el comprador.
   */
  CHECKOUT_RESERVATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(DEFAULT_CHECKOUT_RESERVATION_SECONDS),

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

  // --- Avisos (M05) -----------------------------------------------------
  /**
   * `log` escribe una linea y no molesta a nadie, que es por que es el default:
   * un clon del repositorio arranca sin que nadie genere claves. `webpush` es
   * el camino real.
   */
  NOTIFICATION_PROVIDER: z.enum(['log', 'webpush']).default('log'),
  /**
   * Clave publica VAPID. **Se puede publicar**: el navegador la necesita para
   * suscribirse, asi que viaja al cliente a proposito.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  /** Clave privada VAPID. Nunca sale del servidor. Nunca se loguea. */
  VAPID_PRIVATE_KEY: z.string().optional(),
  /**
   * A quien contactar si los avisos molestan.
   *
   * Los servicios de push lo exigen --un `mailto:` o una URL-- y lo usan para
   * avisarle a un humano antes de bloquear un remitente. No es decorativo.
   */
  VAPID_SUBJECT: z.string().default('mailto:hola@vivoshop.live'),

  // --- Imagenes (M06) ---------------------------------------------------
  /**
   * `local` guarda los bytes en memoria y muere con el proceso, que es por que
   * es el default: un clon del repositorio arranca sin contratar un bucket.
   * `supabase` es el camino real.
   */
  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  /** Base del proyecto de Supabase, p. ej. `https://abc.supabase.co`. */
  SUPABASE_URL: z.string().optional(),
  /**
   * Clave de servicio. Firma las subidas y **nunca** sale del servidor.
   *
   * Es la credencial mas poderosa del proyecto de Supabase: salta las politicas
   * de fila. No va al navegador, no se loguea, no aparece en `/health`.
   */
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('vivoshop-media'),

  // --- Ingresar con Google / Meta (M07) ---------------------------------
  /**
   * Que proveedores de identidad se ofrecen, separados por coma.
   *
   * `fake` es el default por lo mismo que `mock` y `fake` en los otros ejes: un
   * clon del repositorio tiene que ejercitar el recorrido completo sin que
   * nadie cree credenciales en la consola de Google. Vacio apaga el ingreso
   * social por completo y la pantalla no dibuja ningun boton.
   *
   * En produccion `fake` esta prohibido --lo corta el guardia de abajo--:
   * seria un boton que le da la cuenta de `demo@vivo.uy` a cualquiera.
   */
  OAUTH_PROVIDERS: z.string().default('fake'),
  /** Identificador publico del cliente OAuth. Se puede loguear. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Nunca sale del servidor. Nunca se loguea. Nunca va a un navegador. */
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),

  // --- Correo (M08) ------------------------------------------------------
  /**
   * Como se manda el correo. Hoy solo lo usa el restablecimiento de contrasena.
   *
   * `log` lo escribe en la consola y es el default: un clon del repositorio
   * recorre el flujo entero sin contratar nada. En produccion esta **prohibido**
   * --la pantalla diria "te mandamos un email" y nadie recibiria nada, dejando
   * a alguien esperando algo que nunca llega--.
   *
   * `none` apaga la recuperacion por completo, y es una produccion valida: la
   * pantalla no ofrece "olvide mi contrasena" y nadie queda esperando. Es mejor
   * no tener la funcion que fingirla.
   */
  EMAIL_PROVIDER: z.enum(['log', 'none', 'resend']).default('log'),
  /** Nunca sale del servidor. Nunca se loguea. */
  RESEND_API_KEY: z.string().optional(),
  /** El remitente. Su dominio tiene que estar verificado en Resend. */
  EMAIL_FROM: z.string().default('VivoShop <hola@vivoshop.live>'),
  /** Base publica de la web, para armar el enlace del correo. */
  WEB_PUBLIC_URL: z.string().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  readonly corsOrigins: string[];
  /**
   * `OAUTH_PROVIDERS` ya partido y validado.
   *
   * Vive acá y no en cada consumidor para que la lista se valide una sola vez,
   * al arrancar: un nombre mal escrito tiene que frenar el despliegue, no
   * aparecer como un botón que no hace nada.
   */
  readonly identityProviders: readonly string[];
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
  // Falla al arrancar, no en silencio: una comodidad de desarrollo que reparte
  // permisos tiene que ser imposible de dejar puesta sin querer en un deploy.
  if (env.DEV_ADMIN_EMAIL && (env.NODE_ENV === 'production' || env.DATA_DRIVER === 'postgres')) {
    throw new Error(
      'DEV_ADMIN_EMAIL solo funciona en desarrollo con DATA_DRIVER=memory. ' +
        'Contra una base real, otorgá el rol con `pnpm db:grant-admin`.',
    );
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
  if (env.STORAGE_PROVIDER === 'supabase') {
    const missing = (['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'] as const).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`STORAGE_PROVIDER=supabase requires ${missing.join(', ')}`);
    }
  }
  // Los bytes en memoria mueren con el proceso: en produccion eso significa que
  // cada deploy borra las fotos de perfil de todo el mundo.
  if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') {
    throw new Error(
      'STORAGE_PROVIDER=local guarda las imagenes en memoria y las pierde en cada deploy. ' +
        'Configurá STORAGE_PROVIDER=supabase con SUPABASE_URL y SUPABASE_SERVICE_KEY.',
    );
  }
  const identityProviders = env.OAUTH_PROVIDERS.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of identityProviders) {
    if (!['fake', 'google', 'meta'].includes(name)) {
      throw new Error(`OAUTH_PROVIDERS no conoce "${name}". Valores: fake, google, meta.`);
    }
  }
  if (identityProviders.includes('google')) {
    const missing = (['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const).filter(
      (key) => !env[key],
    );
    if (missing.length > 0) {
      throw new Error(`OAUTH_PROVIDERS con google requiere ${missing.join(', ')}`);
    }
  }
  if (identityProviders.includes('meta')) {
    const missing = (['META_APP_ID', 'META_APP_SECRET'] as const).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`OAUTH_PROVIDERS con meta requiere ${missing.join(', ')}`);
    }
  }
  // El proveedor falso le entrega la cuenta de demo a cualquiera que toque el
  // boton. En una maquina de desarrollo es comodo; en produccion es la puerta
  // abierta, y por eso el proceso se niega a arrancar asi.
  if (env.NODE_ENV === 'production' && identityProviders.includes('fake')) {
    throw new Error(
      'OAUTH_PROVIDERS=fake entrega una cuenta de demostración a cualquiera. ' +
        'En producción usá google (o dejá OAUTH_PROVIDERS vacío para apagar el ingreso social).',
    );
  }
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    throw new Error('EMAIL_PROVIDER=resend requiere RESEND_API_KEY');
  }
  // `log` en produccion es peor que no tener la funcion: la pantalla promete un
  // correo que nunca sale, y quien perdio su contrasena se queda esperando sin
  // ver un solo error. Si todavia no hay proveedor, `none` la apaga de frente.
  if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER === 'log') {
    throw new Error(
      'EMAIL_PROVIDER=log escribe los correos en la consola y no envía nada. ' +
        'En producción usá resend, o none para apagar la recuperación de contraseña.',
    );
  }
  if (env.NOTIFICATION_PROVIDER === 'webpush') {
    const missing = (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `NOTIFICATION_PROVIDER=webpush requires ${missing.join(', ')}. ` +
          'Generalas con: pnpm --filter @vivo/api exec web-push generate-vapid-keys',
      );
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
  if (
    env.NODE_ENV === 'test' &&
    env.DATA_DRIVER === 'postgres' &&
    !isLocalDatabase(env.DATABASE_URL)
  ) {
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
    identityProviders,
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
