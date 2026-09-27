import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadServerConfigOrExit } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';

const config = loadServerConfigOrExit(process.env);
const logger = createLogger(config);

const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);

const app = createApp({ db, logger, config });
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'galena-server listening');
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
