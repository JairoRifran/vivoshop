import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` works entirely offline from the TypeScript schema, so
 * migrations can be produced and reviewed without a running database.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/drizzle/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://vivo:vivo@localhost:5432/vivo',
  },
  verbose: true,
  strict: true,
});
