import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth/auth';
import { createMailer, MailerConfigurationError, type Mailer } from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { createLogger } from './logger';
import { createEjabberdAdminClient } from './xmpp/admin-client';

const config = loadServerConfigOrExit(process.env);
const logger = createLogger(config);

let mailer: Mailer;
try {
  mailer = createMailer(config, logger);
} catch (error) {
  if (error instanceof MailerConfigurationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);

const adminClient = createEjabberdAdminClient(config.xmpp);
const auth = createAuth({ db, config, mailer, adminClient, logger });
const app = createApp({ db, logger, config, auth, adminClient });
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
