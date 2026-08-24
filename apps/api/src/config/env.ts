import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

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
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  readonly corsOrigins: string[];
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

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
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('Refusing to start in production with the development JWT_SECRET');
  }

  return {
    ...env,
    corsOrigins: env.WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  };
}

export const ENV = Symbol('APP_ENV');
