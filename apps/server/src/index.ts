import { eq } from 'drizzle-orm';
import { serve } from '@hono/node-server';
import {
  createLitellmAdminClientFromConfig,
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
} from './ai/litellm-client';
import { approvalCardBody, buildApprovalCardPayload } from './actions/announce';
import {
  type ActionAnnouncer,
  createActionGateway,
  startRecoveryStuckTimer,
  type RecoveryStuckHandle,
} from './actions/gateway';
import { createAgentGateway, type AgentGateway } from './agents/gateway';
import { createApp } from './app';
import { startApprovalsSweeper, type ApprovalsSweeperHandle } from './approvals/sweeper';
import { createAuditRecorder } from './audit/service';
import { createAuth } from './auth/auth';
import { createMailer, MailerConfigurationError, type Mailer } from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { createKeyCipher } from './connections/crypto';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { approvals, ais, groups } from './db/schema';
import { sharedDraftHub } from './drafts/hub';
import { createLogger } from './logger';
import { assertRunnerHubConfig, startRunnerHub, type RunnerHub } from './machines/hub';
import { createDbMachineRegistry } from './machines/registry';
import { createEjabberdAdminClient } from './xmpp/admin-client';
import { jidFor, localpartFor } from './xmpp/provisioning';

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

// Runner hub (T-0071): validated here so a misconfiguration fails fast with
// a single clear message, before the HTTP server starts. The actual listener
// comes up after `serve()` so the API is not delayed.
assertRunnerHubConfig({
  enabled: config.RUNNER_HUB_ENABLED,
  gatewayUrl: config.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL,
});

// One registry, shared with both the machines routes and the hub: the
// route's approve/revoke notifies must reach the hub's listener set.
const machineRegistry = createDbMachineRegistry(db);

// `isMachineOnline` looks up the hub each request, so the routes pick up
// the running hub once `startRunnerHub` resolves. Absent when the hub is
// disabled, so the routes answer `online: false` for everyone.
let runnerHub: RunnerHub | null = null;
const isMachineOnline = (machineId: string): boolean => {
  return runnerHub?.isOnline(machineId) ?? false;
};

// The audit recorder used by both the action gateway and the app: one
// recorder wraps `recordAudit` so a database write error never propagates
// into the caller, and every route that audits shares it.
const auditRecorder = createAuditRecorder({ db, logger });

// T-0092: the agent gateway is built below; the action gateway needs an
// announcer now. The announcer object closes over a mutable reference to
// the agent gateway, so the action gateway can be built first and the
// `postToChat` calls resolve at runtime once `gateway` exists. When the
// agent gateway is disabled (`AGENT_GATEWAY_ENABLED=false`) the announcer
// still exists and simply does nothing — `postToChat` would answer `false`
// anyway, but the `if (gatewayRef === null)` short-circuit avoids the
// database lookup entirely.
let gatewayRef: AgentGateway | null = null;
const announcer: ActionAnnouncer = {
  async approvalRequested(input: { aiId: string; groupId: string | null; approvalId: string }) {
    const { aiId, groupId, approvalId } = input;
    if (gatewayRef === null) {
      return;
    }
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
    if (row === undefined) {
      logger.warn({ aiId, approvalId }, 'approval row missing for announcer; skipping card');
      return;
    }
    const [aiRow] = await db
      .select({ jid: ais.jid, owner: ais.owner })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    if (aiRow === undefined) {
      return;
    }
    const ownerJid = jidFor(localpartFor(aiRow.owner), config.xmpp.domain);
    let roomJid: string | null = null;
    if (groupId !== null) {
      const [groupRow] = await db
        .select({ roomLocalpart: groups.roomLocalpart })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);
      if (groupRow !== undefined) {
        roomJid = jidFor(groupRow.roomLocalpart, config.xmpp.mucDomain);
      }
    }
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: aiRow.jid,
      ownerJid,
      roomJid,
    });
    if (payload === null) {
      logger.warn({ aiId, approvalId }, 'approval card is not valid; nothing was posted');
      return;
    }
    await gatewayRef.postToChat({ aiId, groupId, text: approvalCardBody(row), payload });
  },
  async outcome(input: {
    aiId: string;
    groupId: string | null;
    status: 'executed' | 'failed' | 'cancelled';
    summary: string;
  }) {
    const { aiId, groupId, summary } = input;
    if (gatewayRef === null) {
      return;
    }
    await gatewayRef.postToChat({ aiId, groupId, text: summary });
  },
};

// Action gateway (T-0090): wired in production with an empty adapter
// registry, so every action request is denied `unknown_action` until a
// later task adds an adapter. `onApprovalDecided` is the hook the
// approvals route fires after a successful decision; the recovery loop
// below runs `recoverStuck` once at startup and every five minutes. The
// announcer (T-0092) closes over the agent gateway reference and posts
// every tier-2 request and outcome into the chat.
const actionGateway = createActionGateway({
  db,
  adapters: {},
  audit: auditRecorder,
  logger,
  announce: announcer,
});

const app = createApp({
  db,
  logger,
  config,
  auth,
  adminClient,
  machineRegistry,
  ...(config.RUNNER_HUB_ENABLED ? { isMachineOnline } : {}),
  actionGateway,
});

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
// Wire the agent gateway into the announcer proxy: the action gateway was
// built first, so the announcer captured a `null` placeholder. The agent
// gateway's `postToChat` answers `false` while it is stopped or before it
// starts, which is the same behaviour the spec asks for.
gatewayRef = gateway;
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'galena-server listening');
});

// Runner hub (T-0071): starts only when RUNNER_HUB_ENABLED=true, after the
// HTTP server is listening. A start failure (port in use, bad config) must
// never take the API down, so it logs and the rest of the server keeps
// running. `isMachineOnline` returns false until the hub resolves, then
// forwards to it for every request.
if (config.RUNNER_HUB_ENABLED) {
  startRunnerHub({
    db,
    registry: machineRegistry,
    logger,
    port: config.RUNNER_HUB_PORT,
    gatewayUrl: config.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL,
  })
    .then((hub) => {
      runnerHub = hub;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: message }, 'runner hub failed to start; API continues without it');
    });
}

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

// Approvals sweeper (T-0087): starts after `serve()` resolves so the API is
// already listening, never blocks startup. The handle is held in a variable
// the shutdown sequence closes. The recorder wraps `recordAudit` so a
// database write error never propagates into the timer.
const approvalsSweeper: ApprovalsSweeperHandle = startApprovalsSweeper({
  db,
  audit: createAuditRecorder({ db, logger }),
  logger,
});

// Action gateway recovery loop (T-0090): runs `recoverStuck` after one
// interval and then every five minutes on an unref'd timer. The first
// tick fires after the interval so startup is never blocked.
const recoveryStuck: RecoveryStuckHandle = startRecoveryStuckTimer({
  gateway: actionGateway,
  logger,
});

// One startup sweep: an earlier crash may have left `running` or
// past-due `waiting` rows that we want to surface immediately rather than
// wait up to five minutes for the first timer tick. Failure here logs
// and carries on; the timer will retry on the next tick.
void actionGateway.recoverStuck().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: message }, 'initial recoverStuck sweep failed');
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
  if (runnerHub !== null) {
    await runnerHub.close();
  }
  await gateway.stop();
  approvalsSweeper.close();
  recoveryStuck.close();
  await close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
