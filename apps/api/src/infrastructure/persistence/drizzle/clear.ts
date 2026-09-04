/* c8 ignore start -- an operational script, exercised by running it. */
import { loadEnv } from '../../../config/env';
import { createDatabase, type VivoDatabase } from './client';
import { schema as t } from './schema';

/**
 * Vacía la base de datos entera. Deja el esquema y las migraciones intactos.
 *
 * Existe por una razón concreta: los datos de demostración son excelentes para
 * mostrar el producto y pésimos en una URL pública. Traen cuentas con
 * contraseña `vivo1234`, una de ellas vendedora, que cualquiera que lea el
 * repositorio puede usar.
 *
 * Después de esto la aplicación arranca vacía, que es como arranca de verdad:
 * la primera tienda es la primera persona que se registra.
 *
 * ## Por qué borra TODO, y no solo lo que siembra el seed
 *
 * La primera versión de esto borraba las mismas doce tablas que llena `db:seed`.
 * Alcanzaba mientras la base solo tenía datos de demostración. Pero una
 * producción de verdad acumula cosas que el seed nunca crea —cobros reales,
 * cuentas de cobro conectadas, pujas, disputas, verificaciones— y varias de
 * esas referencian a `users` y `stores` con `onDelete: 'restrict'`. Con la lista
 * corta, `delete(stores)` y `delete(users)` chocaban contra esas filas y la
 * transacción entera se revertía: la base quedaba igual que antes.
 *
 * ## El orden
 *
 * Estricto de hijos a padres. Las únicas que **obligan** un orden son las de
 * `restrict` —`orders`, `payments`, `bid_sessions`, `bids`, `disputes`, todas
 * hacia `users`/`stores`—: hay que vaciarlas antes de tocar a sus padres. El
 * resto es `cascade` o `set null` y se borraría solo, pero se lista explícito
 * igual: una tabla nueva que nadie agregue acá se nota como una fila que
 * sobrevive a un borrado que dijo haber vaciado todo.
 */
export async function clearDatabase(db: VivoDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    // --- Hojas: lo que cuelga de pedidos, pagos, pujas y vivos --------------
    await tx.delete(t.disputes);
    await tx.delete(t.reports);
    await tx.delete(t.blocks);
    await tx.delete(t.bids);
    await tx.delete(t.bidSessions);
    await tx.delete(t.paymentWebhookEvents);
    await tx.delete(t.payments);
    await tx.delete(t.pushDeliveries);
    await tx.delete(t.pushSubscriptions);
    await tx.delete(t.oauthStates);
    await tx.delete(t.identityVerifications);
    await tx.delete(t.businessVerifications);
    await tx.delete(t.sellerPaymentAccounts);
    await tx.delete(t.analyticsEvents);
    await tx.delete(t.idempotencyKeys);
    await tx.delete(t.follows);
    await tx.delete(t.orderItems);
    await tx.delete(t.liveSessionProducts);
    await tx.delete(t.liveMessages);
    // --- Pedidos: el último `restrict` antes de tiendas y usuarios ----------
    await tx.delete(t.orders);
    // --- Catálogo y vivos ---------------------------------------------------
    await tx.delete(t.liveSessions);
    await tx.delete(t.productVariants);
    await tx.delete(t.products);
    await tx.delete(t.stores);
    // --- Identidad: lo que cuelga de la cuenta, y la cuenta ------------------
    await tx.delete(t.loginStates);
    await tx.delete(t.userIdentities);
    await tx.delete(t.passwordResetTokens);
    await tx.delete(t.users);
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to clear.');

  const host = hostOf(env.DATABASE_URL);

  // La red de seguridad: hay que tipear el host exacto en CONFIRM_HOST.
  //
  // Esto borra TODO y no se deshace. Un `pnpm db:clear` de más --el comando de
  // arriba en el historial de la terminal, un script mal apuntado-- se lleva la
  // base entera. La confirmación no es un "¿estás seguro?" que se contesta sin
  // mirar: pide el nombre del servidor, así que para pasarla hay que haber visto
  // contra cuál se está corriendo. Y sirve igual en un script, que es donde un
  // "sí" automático sería más peligroso.
  const confirm = process.env.CONFIRM_HOST;
  if (confirm !== host) {
    console.error(
      `\nEsto BORRA TODA la base en ${host} y no se puede deshacer.\n\n` +
        `Para confirmar, corré de nuevo con el host exacto:\n` +
        `  CONFIRM_HOST=${host} pnpm db:clear\n`,
    );
    process.exitCode = 1;
    return;
  }

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
