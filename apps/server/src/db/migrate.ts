import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import type { PgliteServerDatabase, ServerDatabase } from './client';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: ServerDatabase): Promise<void> {
  if (isPglite(db)) {
    await migratePglite(db, { migrationsFolder });
    return;
  }
  await migratePostgres(db, { migrationsFolder });
}

function isPglite(db: ServerDatabase): db is PgliteServerDatabase {
  return typeof db.$client !== 'function';
}
