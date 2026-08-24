import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

/**
 * La versión desplegada que publica `/health`.
 *
 * Se prueba acá y no en el test de integración porque lo que importa es la
 * derivación, y esa depende de variables que un test de integración no puede
 * variar sin reiniciar la aplicación entera.
 */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATA_DRIVER: 'memory',
  CACHE_DRIVER: 'memory',
};

const PRODUCTION: NodeJS.ProcessEnv = {
  ...BASE,
  NODE_ENV: 'production',
  JWT_SECRET: 'production-secret-value-000000000000',
};

const SHA = 'cd206a699103e727f7929f0279f09e8b96cf6e58';

describe('qué versión está corriendo', () => {
  it('muestra los primeros 7 caracteres del commit', () => {
    const env = loadEnv({ ...PRODUCTION, RAILWAY_GIT_COMMIT_SHA: SHA });

    expect(env.version).toBe('cd206a6');
    // El resto del SHA no viaja. No es un secreto, pero publicar 40
    // caracteres donde alcanzan 7 es ruido en cada respuesta.
    expect(env.version).toHaveLength(7);
  });

  it('sin commit, en una máquina de desarrollo dice development', () => {
    expect(loadEnv(BASE).version).toBe('development');
  });

  it('sin commit, en producción dice unknown', () => {
    // La distinción importa: `development` en un servidor sería afirmar algo
    // falso sobre lo que está corriendo. `unknown` dice la verdad — el host no
    // inyectó el commit y no sabemos qué versión es.
    expect(loadEnv(PRODUCTION).version).toBe('unknown');
  });

  it('normaliza un SHA en mayúsculas', () => {
    expect(loadEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: SHA.toUpperCase() }).version).toBe('cd206a6');
  });

  it('acepta un SHA ya corto', () => {
    expect(loadEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: 'abc1234' }).version).toBe('abc1234');
  });
});

describe('lo que llega en la variable no se publica tal cual', () => {
  /**
   * `/health` es público y sin autenticación. Si el valor se recortara sin
   * validarlo, cualquier cosa que quedara en esa variable —una ruta, un token
   * pegado por error, un fragmento de configuración— saldría por un endpoint
   * abierto. Se valida que sea un SHA; si no lo es, no se muestra.
   */
  const BASURA = [
    'no-es-un-sha',
    '../../etc/passwd',
    'ghp_uNtOkEnQuEnAdIeQuIsOfIlTrAr',
    '<script>alert(1)</script>',
    'zzzzzzz',
    '   ',
    '',
  ];

  for (const value of BASURA) {
    it(`descarta ${JSON.stringify(value)}`, () => {
      expect(loadEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: value }).version).toBe('development');
    });
  }

  it('descarta algo más corto que un SHA reconocible', () => {
    expect(loadEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: 'abc12' }).version).toBe('development');
  });

  it('descarta algo más largo que un SHA', () => {
    expect(loadEnv({ ...BASE, RAILWAY_GIT_COMMIT_SHA: `${SHA}0` }).version).toBe('development');
  });
});

describe('no se expone ninguna otra variable', () => {
  it('el SHA completo no queda en la configuración', () => {
    const env = loadEnv({ ...PRODUCTION, RAILWAY_GIT_COMMIT_SHA: SHA });

    // Se lee de la fuente cruda y se descarta: el esquema no lo declara, así
    // que no hay forma de que alguien lo exponga más adelante por descuido.
    expect(JSON.stringify(env)).not.toContain(SHA);
    expect(env).not.toHaveProperty('RAILWAY_GIT_COMMIT_SHA');
  });

  it('ninguna otra variable de Railway entra a la configuración', () => {
    const env = loadEnv({
      ...PRODUCTION,
      RAILWAY_GIT_COMMIT_SHA: SHA,
      RAILWAY_PRIVATE_DOMAIN: 'api.railway.internal',
      RAILWAY_PROJECT_ID: 'proj_secreto',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    });

    const publicado = JSON.stringify(env);
    expect(publicado).not.toContain('api.railway.internal');
    expect(publicado).not.toContain('proj_secreto');
  });
});
