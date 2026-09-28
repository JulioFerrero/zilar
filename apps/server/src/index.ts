import { serve } from '@hono/node-server';
import { createLitellmAdminClientFromConfig } from './ai/litellm-client';
import { createAgentGateway } from './agents/gateway';
import { createApp } from './app';
import { createAuth } from './auth/auth';
import { createMailer, MailerConfigurationError, type Mailer } from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { createKeyCipher } from './connections/crypto';
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

// Agent gateway (T-0034): off unless AGENT_GATEWAY_ENABLED=true, and inert
// without LiteLLM plus the key cipher. It connects each active AI to XMPP so
// owner DMs get replies.
const gatewayCipher =
  config.GALENA_KEY_ENCRYPTION_KEY === undefined
    ? undefined
    : createKeyCipher(config.GALENA_KEY_ENCRYPTION_KEY);
const gatewayLitellm =
  config.LITELLM_MASTER_KEY === undefined ? undefined : createLitellmAdminClientFromConfig(config);
const gateway = createAgentGateway(
  {
    db,
    xmpp: config.xmpp,
    adminClient,
    ...(gatewayLitellm === undefined ? {} : { litellm: gatewayLitellm }),
    ...(gatewayCipher === undefined ? {} : { cipher: gatewayCipher }),
    logger,
    ...(config.LITELLM_BASE_URL === undefined ? {} : { litellmBaseUrl: config.LITELLM_BASE_URL }),
    ...(config.LITELLM_MASTER_KEY === undefined
      ? {}
      : { masterKeyForRedaction: config.LITELLM_MASTER_KEY }),
  },
  { enabled: config.AGENT_GATEWAY_ENABLED },
);
await gateway.start();
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
  await gateway.stop();
  await close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
