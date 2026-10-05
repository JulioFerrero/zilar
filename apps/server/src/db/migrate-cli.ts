import { loadServerConfigOrExit } from '../config';
import { createLogger } from '../logger';
import { createDb } from './client';
import { runMigrations } from './migrate';

const config = loadServerConfigOrExit(process.env);
const logger = createLogger(config);

const { db, close } = createDb(config.DATABASE_URL);

try {
  await runMigrations(db);
  logger.info('database migrations applied');
} finally {
  await close();
}
