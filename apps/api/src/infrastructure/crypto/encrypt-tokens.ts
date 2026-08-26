import { Pool } from 'pg';
import { loadEnv } from '../../config/env';
import { AesGcmSecretBox, SECRET_CONTEXT, loadEncryptionKeys } from './secret-box';

/**
 * Cifra las credenciales que quedaron en texto plano.
 *
 * Se corre una vez, después de desplegar el cifrado. Hasta entonces el sistema
 * lee los valores viejos tal cual —por eso desplegar no rompe una tienda ya
 * conectada— y avisa por log que quedan sin cifrar; cuando ese aviso deja de
 * aparecer, esto ya corrió.
 *
 * ## Por qué es seguro correrlo dos veces
 *
 * Solo toca las filas cuyo valor **no** tiene el sobre `v1.`. Un valor ya
 * cifrado se saltea, así que una segunda corrida no lo cifra dos veces ni lo
 * corrompe. Si se interrumpe a la mitad, se vuelve a correr y termina lo que
 * falta.
 *
 * ## Lo que no hace
 *
 * No descifra, no rota y no toca nada que no sean las dos columnas de tokens.
 * Rotar una clave es otro problema —y con `ENCRYPTION_KEY_PREVIOUS` no hace
 * falta migrar nada— así que meterlo acá sería mezclar dos cosas que fallan
 * distinto.
 *
 * ```
 * pnpm --filter @vivo/api exec tsx src/infrastructure/crypto/encrypt-tokens.ts
 * ```
 */
const SEALED_PREFIX = 'v1.';

interface Row {
  store_id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.DATA_DRIVER !== 'postgres' || !env.DATABASE_URL) {
    // El driver en memoria no escribe nada en disco: no hay nada que migrar.
    console.warn('DATA_DRIVER no es postgres. No hay credenciales en reposo que cifrar.');
    return;
  }

  const secrets = new AesGcmSecretBox(
    loadEncryptionKeys({
      ...(env.ENCRYPTION_KEY ? { ENCRYPTION_KEY: env.ENCRYPTION_KEY } : {}),
      ...(env.ENCRYPTION_KEY_PREVIOUS
        ? { ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY_PREVIOUS }
        : {}),
      isProduction: env.isProduction,
    }),
  );

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ...(env.DATABASE_CA_CERT
      ? { ssl: { ca: env.DATABASE_CA_CERT, rejectUnauthorized: true } }
      : {}),
  });

  try {
    const { rows } = await pool.query<Row>(
      'select store_id, provider, access_token, refresh_token from seller_payment_accounts',
    );

    let sealed = 0;
    let already = 0;

    for (const row of rows) {
      const pending =
        (row.access_token !== null && !row.access_token.startsWith(SEALED_PREFIX)) ||
        (row.refresh_token !== null && !row.refresh_token.startsWith(SEALED_PREFIX));

      if (!pending) {
        already += 1;
        continue;
      }

      const access = row.access_token?.startsWith(SEALED_PREFIX)
        ? row.access_token
        : secrets.seal(row.access_token, SECRET_CONTEXT.accessToken);
      const refresh = row.refresh_token?.startsWith(SEALED_PREFIX)
        ? row.refresh_token
        : secrets.seal(row.refresh_token, SECRET_CONTEXT.refreshToken);

      // Con `where` sobre los valores viejos: si otro proceso los reescribió
      // entre la lectura y esta actualización, esta no pisa nada.
      const result = await pool.query(
        `update seller_payment_accounts
            set access_token = $1, refresh_token = $2
          where store_id = $3 and provider = $4
            and access_token is not distinct from $5
            and refresh_token is not distinct from $6`,
        [access, refresh, row.store_id, row.provider, row.access_token, row.refresh_token],
      );

      if (result.rowCount === 1) sealed += 1;
      else console.warn(`La cuenta ${row.store_id}/${row.provider} cambió mientras migraba; se saltea.`);
    }

    // Sin ids ni valores: solo cuántas. Un log de migración no es lugar para
    // nada que se parezca a una credencial.
    console.warn(`Cuentas: ${rows.length}. Cifradas ahora: ${sealed}. Ya cifradas: ${already}.`);

    /**
     * Y se comprueba el resultado, en vez de confiar en haberlo intentado.
     *
     * Esta migración ya falló una vez de la peor forma posible: en silencio.
     * El `preDeployCommand` encadenaba dos comandos con `&&` y el segundo nunca
     * se ejecutó —el host no pasa el comando por un shell, así que `node`
     * recibió el resto como argumentos y los ignoró—. La migración "terminó
     * bien", el despliegue salió verde, y los tokens seguían en claro. Nadie se
     * enteró hasta que alguien miró la columna a mano.
     *
     * Un proceso que verifica lo que hizo no puede fallar así: si queda algo
     * sin cifrar, sale distinto de cero y el despliegue se detiene.
     */
    const { rows: remaining } = await pool.query<{ n: string }>(
      `select count(*)::text as n from seller_payment_accounts
        where (access_token is not null and access_token not like 'v1.%')
           or (refresh_token is not null and refresh_token not like 'v1.%')`,
    );
    const left = Number(remaining[0]?.n ?? '0');
    if (left > 0) {
      throw new Error(
        `Quedaron ${left} cuentas sin cifrar. El despliegue se detiene: ` +
          'poner esto online dejaría credenciales en texto plano.',
      );
    }

    console.warn('Verificado: no quedan credenciales en texto plano.');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
