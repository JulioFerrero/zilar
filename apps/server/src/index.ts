import { serve } from '@hono/node-server';
import { createLitellmAdminClientFromConfig, redactSecrets } from './ai/litellm-client';
import { createAgentGateway } from './agents/gateway';
import { createApp } from './app';
import { createAuth } from './auth/auth';
import { createMailer, MailerConfigurationError, type Mailer } from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { createKeyCipher } from './connections/crypto';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { sharedDraftHub } from './drafts/hub';
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
    // The shared in-process hub: the gateway publishes drafts here and the
    // `/api/drafts/stream` route (mounted in app.ts) streams them out.
    drafts: { hub: sharedDraftHub },
  },
  { enabled: config.AGENT_GATEWAY_ENABLED },
);
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'galena-server listening');
});

// The gateway logs each AI in over XMPP, which can take a while when ejabberd
// is slow or down: start it after the server is listening and never block on
// it. Shutdown below still awaits `gateway.stop()`, which is safe while a
// start is in flight (sessions it no longer owns are dropped on connect).
void gateway.start().catch((error: unknown) => {
  const secrets = config.LITELLM_MASTER_KEY === undefined ? [] : [config.LITELLM_MASTER_KEY];
  const message = error instanceof Error ? error.message : String(error);
  const err = new Error(redactSecrets(message, secrets));
  if (error instanceof Error) {
    err.stack = redactSecrets(error.stack ?? '', secrets);
  }
  logger.error({ err }, 'agent gateway failed to start');
});

// How long open connections (SSE streams) get before they are closed, and the
// point at which a stuck shutdown gives up and exits.
const CONNECTION_GRACE_MS = 3_000;
const FORCE_EXIT_MS = 15_000;

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // `server.close()` waits for every open connection, and the SSE draft
  // streams never end on their own, so a plain close hangs until SIGKILL.
  // Drop idle connections at once, live ones after a short grace, and exit
  // hard if anything else still blocks the shutdown.
  const forceExit = setTimeout(() => {
    logger.error('shutdown timed out; exiting');
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceExit.unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    // `serve()` returns an HTTP/1 server here; the type also allows HTTP/2.
    if ('closeAllConnections' in server) {
      server.closeIdleConnections();
      setTimeout(() => server.closeAllConnections(), CONNECTION_GRACE_MS).unref();
    }
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
