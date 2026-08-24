/* c8 ignore start -- an operational script, exercised by running it. */
import { loadEnv } from '../../../config/env';
import { createDatabase, type VivoDatabase } from './client';
import { schema as t } from './schema';

/**
 * Vacía la base de datos. Deja el esquema y las migraciones intactos.
 *
 * Existe por una razón concreta: los datos de demostración son excelentes para
 * mostrar el producto y pésimos en una URL pública. Traen cuentas con
 * contraseña `vivo1234`, una de ellas vendedora, que cualquiera que lea el
 * repositorio puede usar.
 *
 * Es la contraparte de `db:seed`, y borra exactamente las mismas tablas en el
 * mismo orden — hijos antes que padres — para que no haya forma de que una se
 * actualice y la otra no.
 *
 * Después de esto la aplicación arranca vacía, que es como arranca de verdad:
 * la primera tienda es la primera persona que se registra.
 */
export async function clearDatabase(db: VivoDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(t.analyticsEvents);
    await tx.delete(t.idempotencyKeys);
    await tx.delete(t.orderItems);
    await tx.delete(t.orders);
    await tx.delete(t.liveMessages);
    await tx.delete(t.liveSessionProducts);
    await tx.delete(t.liveSessions);
    await tx.delete(t.follows);
    await tx.delete(t.productVariants);
    await tx.delete(t.products);
    await tx.delete(t.stores);
    await tx.delete(t.users);
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to clear.');

  // Sin red de seguridad por NODE_ENV, al revés que el seed: vaciar una base de
  // producción es justamente para lo que se escribió esto. Lo que sí hace es
  // decir en voz alta contra qué servidor va a correr.
  const host = hostOf(env.DATABASE_URL);
  console.log(`\nVaciando la base en ${host}\n`);

  const { db, pool } = createDatabase(env.DATABASE_URL, {
    mode: env.DATABASE_SSL,
    caCert: env.DATABASE_CA_CERT,
  });

  try {
    await clearDatabase(db);
    const counts = await Promise.all(
      ['users', 'stores', 'products', 'live_sessions', 'orders'].map(async (table) => {
        const result = await pool.query<{ count: string }>(
          `select count(*)::text as count from ${table}`,
        );
        return `${table}=${result.rows[0]?.count ?? '?'}`;
      }),
    );
    console.log(`Base vacía. ${counts.join('  ')}`);
    console.log('La aplicación arranca sin tiendas: la primera es quien se registre.\n');
  } finally {
    await pool.end();
  }
}

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return '(host ilegible)';
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
