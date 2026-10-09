import { loadServerConfigOrExit } from '../config';
import { createLogger } from '../logger';
import { disposeSqlRuntime, registerSqlRuntime } from '../effect/sql';
import { createDb } from './client';
import { runMigrations } from './migrate';

const config = loadServerConfigOrExit(process.env);
const logger = createLogger(config);

const { db, close } = createDb(config.DATABASE_URL);

try {
  // The migrator runs on `effect/sql`, so this script registers the runtime too.
  registerSqlRuntime(db, config.DATABASE_URL);
  await runMigrations(db);
  logger.info('database migrations applied');
} finally {
  // Dispose the `effect/sql` pool before closing the drizzle client it shares
  // the database with.
  await disposeSqlRuntime(db);
  await close();
}
