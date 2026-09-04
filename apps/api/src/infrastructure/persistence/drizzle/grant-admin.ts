/* c8 ignore start -- an operational script, exercised by running it. */
import { eq } from 'drizzle-orm';
import { USER_ROLES, type UserRole } from '@vivo/domain';
import { loadEnv } from '../../../config/env';
import { createDatabase } from './client';
import { schema as t } from './schema';

/**
 * Le da —o le saca— el rol `admin` a una cuenta.
 *
 * El rol existía en `USER_ROLES` desde el primer día y no había forma de
 * otorgarlo: no hay pantalla para hacerlo y no debería haberla. Una casilla de
 * "hacer administrador" en la aplicación es una escalada de privilegios a un
 * clic de distancia de cualquier fallo de autorización; esto, en cambio, exige
 * acceso a la base y a la terminal, que es la única gente que ya podía leer
 * todo de todas formas.
 *
 * Se pide el host igual que en `db:clear`. No es un "¿estás seguro?" que se
 * contesta sin mirar: para pasarlo hay que haber visto contra qué base se está
 * corriendo, que es justo el error que uno comete apurado.
 *
 *   CONFIRM_HOST=<host> pnpm db:grant-admin hola@vivoshop.live
 *   CONFIRM_HOST=<host> pnpm db:grant-admin hola@vivoshop.live --revocar
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const revocar = process.argv.includes('--revocar');

  if (!email || email.startsWith('--')) {
    console.error('\nUso: CONFIRM_HOST=<host> pnpm db:grant-admin <correo> [--revocar]\n');
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const host = hostOf(env.DATABASE_URL);

  if (process.env.CONFIRM_HOST !== host) {
    console.error(
      `\nEsto cambia permisos en la base de ${host}.\n\n` +
        `Para confirmar, corré de nuevo con el host exacto:\n` +
        `  CONFIRM_HOST=${host} pnpm db:grant-admin ${email}${revocar ? ' --revocar' : ''}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const { db, pool } = createDatabase(env.DATABASE_URL, {
    mode: env.DATABASE_SSL,
    caCert: env.DATABASE_CA_CERT,
  });

  try {
    const filas = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1);
    const usuario = filas[0];
    if (!usuario) {
      console.error(`\nNo hay ninguna cuenta con el correo ${email} en ${host}.\n`);
      process.exitCode = 1;
      return;
    }

    // Se parte de lo que ya tiene: los roles son aditivos y pisar el arreglo
    // entero le sacaría `seller` a quien además vende.
    const actuales = (usuario.roles ?? []).filter((rol): rol is UserRole =>
      (USER_ROLES as readonly string[]).includes(rol),
    );
    const nuevos = revocar
      ? actuales.filter((rol) => rol !== 'admin')
      : [...new Set([...actuales, 'admin' as UserRole])];

    if (nuevos.length === actuales.length && nuevos.every((r, i) => r === actuales[i])) {
      console.log(`\n${email} ya estaba como querías: [${actuales.join(', ')}]\n`);
      return;
    }

    await db.update(t.users).set({ roles: nuevos }).where(eq(t.users.id, usuario.id));
    console.log(`\n${email}: [${actuales.join(', ')}] → [${nuevos.join(', ')}]`);
    console.log(
      revocar
        ? 'Ya no puede entrar al panel.\n'
        : 'Ya puede entrar a /admin. Si tenía sesión abierta, el rol se lee en cada pedido.\n',
    );
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
