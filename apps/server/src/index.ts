import { serve } from '@hono/node-server';
import {
  createLitellmAdminClientFromConfig,
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
} from './ai/litellm-client';
import { createProductionAnnouncer, type PostToChatInput } from './actions/production-announcer';
import { buildDemoEchoAdapter } from './actions/demo';
import {
  type ActionAnnouncer,
  createActionGateway,
  startRecoveryStuckTimer,
  type RecoveryStuckHandle,
} from './actions/gateway';
import { buildAlwaysEligible, buildRegistry } from './actions/registry';
import { createAgentGateway, type AgentGateway } from './agents/gateway';
import { createApp } from './app';
import { resolveStorageDir } from './stickers/service';
import { startApprovalsSweeper, type ApprovalsSweeperHandle } from './approvals/sweeper';
import { createAuditRecorder } from './audit/service';
import { createAuth } from './auth/auth';
import {
  createMailer,
  createResendMailer,
  CurrentMailer,
  MailerConfigurationError,
  type Mailer,
} from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { getMailSettings, settingsCipherFor } from './setup/settings';
import { createKeyCipher } from './connections/crypto';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { createArchivePool } from './search/service';
import { createPushCipher } from './push/crypto';
import { loadPushConfig, pushConfigError, type PushConfig } from './push/config';
import { startPushComponent, type PushComponentHandle } from './push/component';
import { createWebPushSender } from './push/sender';
import { reconcileRoomSubscriptionOptions } from './topics/rooms';
import { sharedDraftHub } from './drafts/hub';
import { createLogger } from './logger';
import { assertRunnerHubConfig, startRunnerHub, type RunnerHub } from './machines/hub';
import { createDbMachineRegistry } from './machines/registry';
import { buildRoutineScheduler, type RoutineSchedulerHandle } from './routines/wiring';
import { ensureWritableDir, warnOnEmptyStorageDir } from './startup';
import { createEjabberdAdminClient } from './xmpp/admin-client';
import { runTool } from './sandbox/run-tool';
import { buildToolAdapters } from './tools/adapters';
import type { ToolRunner } from './tools/types';
import { buildWebToolsAdapters } from './web-tools/adapters';

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

// First-run setup (T-0161): the auth flow sends through this holder, so
// the setup screen can swap the transport without a restart. Stored
// Resend settings (from a finished setup) take effect here at boot;
// explicit `MAIL_TRANSPORT`/`SMTP_*` env already set the transport above
// and stored settings are ignored for it.
const currentMailer = new CurrentMailer(mailer);
if (config.MAIL_TRANSPORT === undefined) {
  const stored = await getMailSettings(db, settingsCipherFor(config));
  if (stored) {
    currentMailer.use(createResendMailer(config, logger, stored));
  }
}

// Stickers (T-0120): the storage dir must exist or be creatable and
// writable at startup, so a bad mount fails fast with a clear message
// instead of failing the first upload. Resolved against the server package
// root like the routes, so a relative value means the same dir here and there whatever the cwd is. T-0146: when the dir did not exist yet and is
// created now, the startup helper logs ONE warning line with the resolved
// path — a relative value resolving to an empty, unexpected directory (e.g.
// a build step moved the package root) is the "moved base" case, and the
// resolved path in the line says where the files actually land. Only when
// the directory holds no stickers while the database has sticker rows is
// the mismatch certain; that second line is logged below.
const stickerDir = resolveStorageDir(config.STICKER_STORAGE_DIR);
await ensureWritableDir(stickerDir, 'STICKER_STORAGE_DIR');
await warnOnEmptyStorageDir({
  db,
  storageDir: stickerDir,
  warn: (message) => logger.warn(message),
});

// Avatars (T-0165): same rules as the sticker dir — a missing directory is
// created, an unwritable one fails fast with a clear message.
const avatarDir = resolveStorageDir(config.AVATAR_STORAGE_DIR);
await ensureWritableDir(avatarDir, 'AVATAR_STORAGE_DIR');

const adminClient = createEjabberdAdminClient(config.xmpp);
const auth = createAuth({ db, config, mailer: currentMailer, adminClient, logger });

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
// announcer now. The announcer closes over a mutable reference to the
// agent gateway, so the action gateway can be built first and the
// `postToChat` calls resolve at runtime once `gateway` exists. When the
// agent gateway is disabled (`AGENT_GATEWAY_ENABLED=false`) the announcer
// still exists and simply does nothing — `postToChat` would answer `false`
// anyway, but the `if (gatewayRef === null)` short-circuit avoids the
// database lookup entirely.
let gatewayRef: AgentGateway | null = null;
const announcer: ActionAnnouncer = createProductionAnnouncer({
  db,
  domain: config.xmpp.domain,
  mucDomain: config.xmpp.mucDomain,
  logger,
  getGateway: (): { postToChat(input: PostToChatInput): Promise<boolean> } | null => gatewayRef,
});

// Action gateway (T-0090): wired in production with an empty adapter
// registry by default, so every action request is denied `unknown_action`
// until a later task adds a real adapter. The demo adapter (T-0093) is
// registered only when `ACTION_DEMO_ENABLED=true`; off in production, it
// is harmless and exists to prove the `request_action` tool end-to-end.
// `onApprovalDecided` is the hook the approvals route fires after a
// successful decision; the recovery loop below runs `recoverStuck` once
// at startup and every five minutes. The announcer (T-0092) closes over
// the agent gateway reference and posts every tier-2 request and outcome
// into the chat.
//
// T-0099: `alwaysEligible` is built from the same registry. Adapters
// that opted in (`allowAlways: true`) and report no cost are always
// eligible; money adapters and non-opted-in adapters never are.
//
// T-0105: when `TOOLS_ENABLED=true`, the real sandbox runner is built
// from T-0102 (`runTool` with default limits) and the tool/routine
// adapters are registered next to (not instead of) the demo adapter.
// When false, none of this exists and manual runs answer 501
// `runner_unavailable` (T-0103). `TOOLS_ENABLED=true` with
// `ROUTINES_ENABLED=false` is valid: tools work and `routine.schedule`
// is not registered. Tool code written by models runs on this server in
// the sandbox (see `docs/TOOL_SANDBOX.md`).
const toolRunner: ToolRunner | undefined = config.TOOLS_ENABLED
  ? (params) =>
      runTool({ source: params.source, input: params.input, allowedHosts: params.allowedHosts })
  : undefined;
// T-0125: when `WEB_TOOLS_ENABLED=true`, the gateway-level web tools
// (`web.fetch`, `web.wikipedia`, `web.price`, `web.feed`, best-effort
// `web.search`) are registered next to the tool/routine adapters. They
// are separate from the sandbox: AI-written tools still fetch only
// their approved hosts through `host-fetch`. `WEB_SEARCH_PROVIDER=none`
// unregisters `web.search`. Nothing changes when the flag is off.
const webToolsAdapters =
  config.WEB_TOOLS_ENABLED === true
    ? buildWebToolsAdapters({ searchProviderName: config.WEB_SEARCH_PROVIDER })
    : [];
const actionAdapters = [
  ...(config.ACTION_DEMO_ENABLED ? [buildDemoEchoAdapter()] : []),
  ...webToolsAdapters,
  ...(toolRunner === undefined
    ? []
    : buildToolAdapters({
        db,
        runner: toolRunner,
        routinesEnabled: config.ROUTINES_ENABLED,
        audit: auditRecorder,
        post: ({ aiId, groupId, topicId, text }) => {
          const gateway = gatewayRef;
          if (gateway === null) {
            return Promise.resolve(false);
          }
          return gateway.postToChat({
            aiId,
            groupId,
            ...(topicId === undefined ? {} : { topicId }),
            text,
          });
        },
      })),
];
const actionRegistry = buildRegistry(actionAdapters);
const alwaysEligible = buildAlwaysEligible(actionRegistry);
const actionGateway = createActionGateway({
  db,
  adapters: actionRegistry,
  audit: auditRecorder,
  logger,
  announce: announcer,
});

// The archive pool is shared with push below: one pool, two readers.
const archivePool =
  config.XMPP_ARCHIVE_DATABASE_URL === undefined
    ? undefined
    : createArchivePool(config.XMPP_ARCHIVE_DATABASE_URL);

// Push env (T-0119): separate from the server config so push stays optional.
const push: PushConfig = loadPushConfig(process.env);

const app = createApp({
  db,
  logger,
  config,
  auth,
  adminClient,
  mailer: currentMailer,
  machineRegistry,
  // Message search (T-0117): a separate small pool on the ejabberd archive
  // with a 3 s statement timeout. Absent = GET /api/search answers 501.
  // Push (T-0119) shares the same pool to resolve who/where from the archive.
  ...(archivePool === undefined ? {} : { archive: archivePool }),
  push,
  ...(config.RUNNER_HUB_ENABLED ? { isMachineOnline } : {}),
  actionGateway,
  alwaysEligible,
  // T-0105: the same sandbox runner the adapters use. Absent = manual
  // runs answer 501 `runner_unavailable`.
  ...(toolRunner === undefined ? {} : { toolRunner }),
});

// Push component (T-0119): off unless PUSH_ENABLED=true. A misconfigured
// flag (keys, component credentials or storage key missing) logs one error
// and stays off; without the archive pool it also stays off, because the
// component could not resolve who/where and would have to guess. A start
// failure never takes the API down: the component reconnects on its own and
// the shutdown below still stops it.
let pushComponent: PushComponentHandle | null = null;
{
  const pushError = pushConfigError(push);
  if (!push.PUSH_ENABLED) {
    logger.info('push is disabled (PUSH_ENABLED=false)');
  } else if (pushError !== null) {
    logger.error({ err: pushError }, 'push stays off');
  } else if (archivePool === undefined) {
    logger.error(
      'push stays off: XMPP_ARCHIVE_DATABASE_URL is not set, so notifications could not be resolved',
    );
  } else {
    try {
      const sender = createWebPushSender({
        PUSH_VAPID_PUBLIC_KEY: push.PUSH_VAPID_PUBLIC_KEY as string,
        PUSH_VAPID_PRIVATE_KEY: push.PUSH_VAPID_PRIVATE_KEY as string,
        PUSH_VAPID_SUBJECT: push.PUSH_VAPID_SUBJECT as string,
      });
      const cipher = createPushCipher(push.PUSH_STORAGE_KEY as string);
      pushComponent = startPushComponent({
        domain: push.PUSH_COMPONENT_JID as string,
        secret: push.PUSH_COMPONENT_SECRET as string,
        port: push.PUSH_COMPONENT_PORT,
        service: {
          db,
          config,
          archive: archivePool,
          cipher,
          sender,
          logger,
          recentlyNotified: new Map(),
        },
        logger,
      });
      // One-time reconcile for rooms created before push: enable
      // `allow_subscription` through `change_room_option`. Best effort —
      // failures are logged per room inside.
      void reconcileRoomSubscriptionOptions({ db, adminClient, logger }).catch((error: unknown) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'push room reconcile failed',
        );
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'push component failed to start; API continues without it',
      );
    }
  }
}
// Agent gateway (T-0034): off unless AGENT_GATEWAY_ENABLED=true, and inert
// without LiteLLM plus the key cipher. It connects each active AI to XMPP so
// owner DMs get replies.
const gatewayCipher =
  config.ZILAR_KEY_ENCRYPTION_KEY === undefined
    ? undefined
    : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY);
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
    // The action gateway is wired whether or not the agent gateway is
    // enabled: `buildTools` returns just the persona tools when the
    // action list is empty, so a missing registry never offers the tool.
    actions: actionGateway,
    // T-0106: the tool guide rides the system prompt only when tools are
    // enabled and tool/routine adapters are registered; the multi-round
    // loop runs `AGENT_TOOL_MAX_ROUNDS` rounds (1 with tools off).
    toolsEnabled: config.TOOLS_ENABLED,
    toolMaxRounds: config.AGENT_TOOL_MAX_ROUNDS,
  },
  { enabled: config.AGENT_GATEWAY_ENABLED },
);
// Wire the agent gateway into the announcer proxy: the action gateway was
// built first, so the announcer captured a `null` placeholder. The agent
// gateway's `postToChat` answers `false` while it is stopped or before it
// starts, which is the same behaviour the spec asks for.
gatewayRef = gateway;
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'zilar-server listening');
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

// Routines scheduler (T-0104): starts after `serve()` resolves when
// `ROUTINES_ENABLED=true`, with the gateway's `postToChat` (via the same
// `gatewayRef` closure the announcer uses). T-0105 wires the sandbox as
// the runner: with the flag on but `TOOLS_ENABLED=false` the builder logs
// its one warning and stays off; with both flags off it stays off
// silently. Stops on shutdown like the other timers.
const routineScheduler: RoutineSchedulerHandle | null = buildRoutineScheduler({
  db,
  routinesEnabled: config.ROUTINES_ENABLED,
  ...(toolRunner === undefined ? {} : { toolRunner }),
  audit: auditRecorder,
  logger,
  post: ({ aiId, groupId, topicId, text }) => {
    const gateway = gatewayRef;
    if (gateway === null) {
      return Promise.resolve(false);
    }
    return gateway.postToChat({
      aiId,
      groupId,
      ...(topicId === undefined ? {} : { topicId }),
      text,
    });
  },
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
  if (pushComponent !== null) {
    await pushComponent.stop();
  }
  await gateway.stop();
  approvalsSweeper.close();
  recoveryStuck.close();
  if (routineScheduler !== null) {
    routineScheduler.stop();
  }
  await close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
