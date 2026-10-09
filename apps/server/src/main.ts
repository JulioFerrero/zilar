// The server's startup and shutdown as Effect programs (T-0838). `index.ts`
// runs `serverProgram` with `NodeRuntime.runMain`; nothing else imports this
// file except its test.
//
// `startServer` builds and starts every component in the order the old
// top-level `index.ts` did, and records each handle on a `RunningServer` as
// soon as it exists. `stopServer` stops whatever has been recorded, in the
// fixed order below (HTTP server first, the SQL runtime last), so it is also
// right when a stop begins while startup is still in flight.
//
// `serverProgram` holds ONE scope finalizer, registered before startup begins:
// `runMain` interrupts the main fiber on SIGINT/SIGTERM, the scope closes, and
// the finalizer runs `stopServer` under the 15 s force-exit. It does not rely
// on the reverse order of acquisition, because the HTTP server must stop first.
import { Cause, Effect, Exit, Fiber, Runtime } from 'effect';
import type { Logger } from 'pino';
import {
  createLitellmAdminClientFromConfig,
  DEFAULT_LITELLM_BASE_URL,
  redactSecrets,
} from './ai/litellm-client';
import { createProductionAnnouncer } from './actions/production-announcer';
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
import { serveEdgeOnNode } from './effect/node-serve';
import { resolveStorageDir } from './stickers/service';
import { startApprovalsSweeper, type ApprovalsSweeperHandle } from './approvals/sweeper';
import { createAuditRecorder } from './audit/service';
import { createAuth } from './auth/auth';
import {
  createMailer,
  createResendMailer,
  CurrentMailer,
  MailerConfigurationError,
} from './auth/mailer';
import { loadServerConfigOrExit } from './config';
import { getMailSettings, settingsCipherFor } from './setup/settings';
import { createKeyCipher } from './connections/crypto';
import { createDb } from './db/client';
import type { ServerDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { disposeSqlRuntime, registerSqlRuntime } from './effect/sql';
import { createArchivePool } from './search/service';
import { createPushCipher } from './push/crypto';
import { loadPushConfigOrExit, pushConfigError, type PushConfig } from './push/config';
import { startPushComponent, type PushComponentHandle } from './push/component';
import { createWebPushSender } from './push/sender';
import { reconcileRoomSubscriptionOptions } from './topics/rooms';
import { sharedDraftHub } from './drafts/hub';
import { createLogger } from './logger';
import { assertRunnerHubConfig, startRunnerHub, type RunnerHub } from './machines/hub';
import { createDbMachineRegistry } from './machines/registry';
import { buildRoutineScheduler, type RoutineSchedulerHandle } from './routines/wiring';
import {
  ensureWritableDir,
  warnOnContainerLayerStorage,
  warnOnEmptyStorageDir,
  warnOnGifConfig,
} from './startup';
import { createEjabberdAdminClient } from './xmpp/admin-client';
import { runTool } from './sandbox/run-tool';
import { buildToolAdapters, type BuildToolAdaptersDeps } from './tools/adapters';
import type { ToolRunner } from './tools/types';
import { buildWebToolsAdapters } from './web-tools/adapters';

// How long open connections (SSE streams) get before they are closed, and the
// point at which a stuck shutdown gives up and exits.
export const CONNECTION_GRACE_MS = 3_000;
export const FORCE_EXIT_MS = 15_000;

/**
 * The handles `stopServer` closes. `startServer` fills each field as soon as
 * the thing it names exists, so a stop that begins during startup closes
 * exactly what was started.
 */
export interface RunningServer {
  logger: Logger | null;
  db: ServerDatabase | null;
  closeDb: (() => Promise<void>) | null;
  closeHttp: (() => Promise<void>) | null;
  runnerHub: Pick<RunnerHub, 'isOnline' | 'close'> | null;
  pushComponent: Pick<PushComponentHandle, 'stop'> | null;
  gateway: Pick<AgentGateway, 'stop' | 'postToChat'> | null;
  approvalsSweeper: Pick<ApprovalsSweeperHandle, 'close'> | null;
  recoveryStuck: Pick<RecoveryStuckHandle, 'close'> | null;
  routineScheduler: Pick<RoutineSchedulerHandle, 'stop'> | null;
}

export function emptyRunning(): RunningServer {
  return {
    logger: null,
    db: null,
    closeDb: null,
    closeHttp: null,
    runnerHub: null,
    pushComponent: null,
    gateway: null,
    approvalsSweeper: null,
    recoveryStuck: null,
    routineScheduler: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stops everything `running` holds, in the order the server has always used:
 * the HTTP server first (it drops idle connections at once and live ones after
 * the grace passed at startup), then the runner hub, push, the agent gateway,
 * the timers and the routine scheduler, and the SQL runtime last. A step that
 * fails ends the sequence, like the old sequential awaits.
 */
export function stopServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { closeHttp, runnerHub, pushComponent, gateway, db, closeDb } = running;
    if (closeHttp !== null) {
      yield* Effect.promise(() => closeHttp());
    }
    if (runnerHub !== null) {
      yield* Effect.promise(() => runnerHub.close());
    }
    if (pushComponent !== null) {
      yield* Effect.promise(() => pushComponent.stop());
    }
    if (gateway !== null) {
      yield* Effect.promise(() => gateway.stop());
    }
    running.approvalsSweeper?.close();
    running.recoveryStuck?.close();
    running.routineScheduler?.stop();
    // The `effect/sql` runtime owns the database pool: dispose it. `closeDb`
    // is the no-op from `createDb`, kept so the shutdown path reads the same.
    if (db !== null) {
      yield* Effect.promise(() => disposeSqlRuntime(db));
    }
    if (closeDb !== null) {
      yield* Effect.promise(() => closeDb());
    }
  });
}

/**
 * The shutdown run by the scope finalizer: arms the force-exit (a stuck stop
 * logs `shutdown timed out; exiting` and exits 1), then runs `stopServer`.
 */
export function shutdownServer(
  running: RunningServer,
  forceExitMs: number = FORCE_EXIT_MS,
): Effect.Effect<void> {
  const forceExit = Effect.sleep(forceExitMs).pipe(
    Effect.andThen(
      Effect.sync(() => {
        running.logger?.error('shutdown timed out; exiting');
        return process.exit(1);
      }),
    ),
  );
  return Effect.gen(function* () {
    const timer = yield* Effect.forkDetach(forceExit, { startImmediately: true });
    yield* stopServer(running).pipe(Effect.ensuring(Fiber.interrupt(timer)));
  });
}

/**
 * Logs `shutting down` with the signal name, once, when the first SIGINT or
 * SIGTERM arrives. `NodeRuntime.runMain` does the interrupting but does not
 * say which signal it was; a second signal logs nothing more.
 */
function logShutdownSignals(running: RunningServer): Effect.Effect<void> {
  return Effect.sync(() => {
    let logged = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        if (logged) {
          return;
        }
        logged = true;
        running.logger?.info({ signal }, 'shutting down');
      });
    }
  });
}

/**
 * Exit codes for `runMain`: a stop that began with a signal ends with the main
 * fiber interrupted and nothing else, which is a clean stop (0). A failed
 * startup or a failed stop keeps the default code (1).
 */
export const serverTeardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
    onExit(0);
    return;
  }
  Runtime.defaultTeardown(exit, onExit);
};

/**
 * The whole server as one program: start, then run until interrupted. Closing
 * its scope (a signal, or a failed startup) runs the shutdown finalizer.
 */
export const serverProgram: Effect.Effect<never> = Effect.scoped(
  Effect.gen(function* () {
    const running = emptyRunning();
    yield* Effect.addFinalizer(() => shutdownServer(running));
    yield* logShutdownSignals(running);
    yield* startServer(running);
    return yield* Effect.never;
  }),
);

/**
 * Builds and starts the server: fail-fast setup, database, migrations,
 * storage checks, components, the HTTP listener, then the work that must
 * never block the API (runner hub, agent gateway, timers, routine scheduler).
 * Resolves once everything is started.
 */
export function startServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const config = yield* Effect.sync(() => loadServerConfigOrExit(process.env));
    const logger = createLogger(config);
    running.logger = logger;

    const mailer = yield* Effect.try({
      try: () => createMailer(config, logger),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        error instanceof MailerConfigurationError
          ? Effect.sync(() => {
              console.error(error.message);
              return process.exit(1);
            })
          : Effect.die(error),
      ),
    );

    const { db, close } = createDb(config.DATABASE_URL);
    running.db = db;
    running.closeDb = close;
    // `createApp` below reuses this runtime; registering here, before any startup
    // step that reads the database (migrations, stored mail settings, startup
    // checks), keeps them all on the same `effect/sql` client.
    registerSqlRuntime(db, config.DATABASE_URL);
    yield* Effect.promise(() => runMigrations(db));

    // First-run setup (T-0161): the auth flow sends through this holder, so
    // the setup screen can swap the transport without a restart. Stored
    // Resend settings (from a finished setup) take effect here at boot;
    // explicit `MAIL_TRANSPORT`/`SMTP_*` env already set the transport above
    // and stored settings are ignored for it.
    const currentMailer = new CurrentMailer(mailer);
    if (config.MAIL_TRANSPORT === undefined) {
      const stored = yield* Effect.promise(() => getMailSettings(db, settingsCipherFor(config)));
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
    yield* Effect.promise(() => ensureWritableDir(stickerDir, 'STICKER_STORAGE_DIR'));
    yield* Effect.promise(() =>
      warnOnEmptyStorageDir({
        db,
        storageDir: stickerDir,
        warn: (message) => logger.warn(message),
      }),
    );

    // Avatars (T-0165): same rules as the sticker dir — a missing directory is
    // created, an unwritable one fails fast with a clear message.
    const avatarDir = resolveStorageDir(config.AVATAR_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(avatarDir, 'AVATAR_STORAGE_DIR'));

    // Background wallpapers (T-0460): same rules as the avatar dir.
    const backgroundDir = resolveStorageDir(config.BACKGROUND_STORAGE_DIR);
    yield* Effect.promise(() => ensureWritableDir(backgroundDir, 'BACKGROUND_STORAGE_DIR'));

    // T-0156: warn once (ids/paths only) when the file stores sit on the
    // container layer in production (no mount: files lost on replace), and when
    // GIF search is half-configured (provider without a key). Absolute paths
    // are the norm in production (`/data/stickers`, `/data/avatars`); warn
    // anyway, since an unmounted named volume lands on the same device as `/`.
    yield* Effect.promise(() =>
      warnOnContainerLayerStorage({
        dirs: [
          { envName: 'STICKER_STORAGE_DIR', dir: stickerDir },
          { envName: 'AVATAR_STORAGE_DIR', dir: avatarDir },
          { envName: 'BACKGROUND_STORAGE_DIR', dir: backgroundDir },
        ],
        isProduction: config.NODE_ENV === 'production',
        warn: (message) => logger.warn(message),
      }),
    );
    warnOnGifConfig({
      provider: config.GIF_PROVIDER,
      apiKey: config.GIF_API_KEY,
      warn: (message) => logger.warn(message),
    });

    const adminClient = createEjabberdAdminClient(config.xmpp);
    const auth = createAuth({ db, config, mailer: currentMailer, adminClient, logger });

    // Runner hub (T-0071): validated here so a misconfiguration fails fast with
    // a single clear message, before the HTTP server starts. The actual listener
    // comes up after the edge server is listening so the API is not delayed.
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
    const isMachineOnline = (machineId: string): boolean => {
      return running.runnerHub?.isOnline(machineId) ?? false;
    };

    // The audit recorder used by both the action gateway and the app: one
    // recorder wraps `recordAudit` so a database write error never propagates
    // into the caller, and every route that audits shares it.
    const auditRecorder = createAuditRecorder({ db, logger });

    // T-0092: the agent gateway is built below; the action gateway needs an
    // announcer now. The announcer closes over `running.gateway`, which stays
    // `null` until the agent gateway exists, so the action gateway can be built
    // first and the `postToChat` calls resolve at runtime once `gateway` exists.
    // When the agent gateway is disabled (`AGENT_GATEWAY_ENABLED=false`) the
    // announcer still exists and simply does nothing — `postToChat` would answer
    // `false` anyway, but the `null` short-circuit avoids the database lookup
    // entirely.
    const announcer: ActionAnnouncer = createProductionAnnouncer({
      db,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
      logger,
      getGateway: () => running.gateway,
    });

    // Posts as the AI through the agent gateway; `false` while it does not
    // exist yet. Shared by the tool adapters and the routine scheduler.
    const post: BuildToolAdaptersDeps['post'] = ({ aiId, groupId, topicId, text }) => {
      const gateway = running.gateway;
      if (gateway === null) {
        return Effect.runPromise(Effect.succeed(false));
      }
      return gateway.postToChat({
        aiId,
        groupId,
        ...(topicId === undefined ? {} : { topicId }),
        text,
      });
    };

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
            post,
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
    // An invalid PUSH_COMPONENT_HOST refuses to boot below (fixed message, no
    // value echoed) instead of dialling a broken URL — see push/config.ts.
    const push: PushConfig = yield* Effect.sync(() => loadPushConfigOrExit(process.env));

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
      yield* Effect.gen(function* () {
        yield* Effect.try({
          try: () => {
            const sender = createWebPushSender({
              PUSH_VAPID_PUBLIC_KEY: push.PUSH_VAPID_PUBLIC_KEY as string,
              PUSH_VAPID_PRIVATE_KEY: push.PUSH_VAPID_PRIVATE_KEY as string,
              PUSH_VAPID_SUBJECT: push.PUSH_VAPID_SUBJECT as string,
            });
            const cipher = createPushCipher(push.PUSH_STORAGE_KEY as string);
            running.pushComponent = startPushComponent({
              domain: push.PUSH_COMPONENT_JID as string,
              secret: push.PUSH_COMPONENT_SECRET as string,
              host: push.PUSH_COMPONENT_HOST,
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
          },
          catch: (error) => error,
        });
        // One-time reconcile for rooms created before push: enable
        // `allow_subscription` through `change_room_option`. Best effort —
        // failures are logged per room inside.
        yield* Effect.tryPromise({
          try: () => reconcileRoomSubscriptionOptions({ db, adminClient, logger }),
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              logger.warn({ error: errorMessage(error) }, 'push room reconcile failed');
            }),
          ),
          Effect.forkDetach({ startImmediately: true }),
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.error(
              { err: errorMessage(error) },
              'push component failed to start; API continues without it',
            );
          }),
        ),
      );
    }
    // Agent gateway (T-0034): off unless AGENT_GATEWAY_ENABLED=true, and inert
    // without LiteLLM plus the key cipher. It connects each active AI to XMPP so
    // owner DMs get replies.
    const gatewayCipher =
      config.ZILAR_KEY_ENCRYPTION_KEY === undefined
        ? undefined
        : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY);
    const gatewayLitellm =
      config.LITELLM_MASTER_KEY === undefined
        ? undefined
        : createLitellmAdminClientFromConfig(config);
    // T-0475: the listener is the platform's own paid feature: it needs the flag,
    // a model and the master key. Any missing piece keeps it off with one warning
    // that names no value.
    const gatewayListener =
      config.LISTENER_ENABLED &&
      config.LISTENER_MODEL !== undefined &&
      config.LITELLM_MASTER_KEY !== undefined
        ? { model: config.LISTENER_MODEL, virtualKey: config.LITELLM_MASTER_KEY }
        : undefined;
    if (config.LISTENER_ENABLED && gatewayListener === undefined) {
      logger.warn(
        'listener is enabled but LISTENER_MODEL or LITELLM_MASTER_KEY is missing; staying off',
      );
    }
    const gateway = createAgentGateway(
      {
        db,
        xmpp: config.xmpp,
        adminClient,
        ...(gatewayLitellm === undefined ? {} : { litellm: gatewayLitellm }),
        ...(gatewayCipher === undefined ? {} : { cipher: gatewayCipher }),
        ...(archivePool === undefined ? {} : { archive: archivePool }),
        logger,
        ...(config.LITELLM_BASE_URL === undefined
          ? {}
          : { litellmBaseUrl: config.LITELLM_BASE_URL }),
        ...(config.LITELLM_MASTER_KEY === undefined
          ? {}
          : { masterKeyForRedaction: config.LITELLM_MASTER_KEY }),
        ...(gatewayListener === undefined ? {} : { listener: gatewayListener }),
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
    // built first, so the announcer saw a `null` placeholder. The agent
    // gateway's `postToChat` answers `false` while it is stopped or before it
    // starts, which is the same behaviour the spec asks for.
    running.gateway = gateway;

    // The Effect edge (T-0730) on its own `node:http` server (T-0733, B1.6).
    // `NodeHttpServer` fills `HttpServerRequest.remoteAddress` from the real
    // socket.
    const { port: boundPort, close: closeNodeServer } = yield* Effect.promise(() =>
      serveEdgeOnNode(app, {
        port: config.PORT,
        connectionGraceMs: CONNECTION_GRACE_MS,
      }),
    );
    running.closeHttp = closeNodeServer;
    logger.info({ port: boundPort }, 'zilar-server listening');

    // Runner hub (T-0071): starts only when RUNNER_HUB_ENABLED=true, after the
    // HTTP server is listening. A start failure (port in use, bad config) must
    // never take the API down, so it logs and the rest of the server keeps
    // running. `isMachineOnline` returns false until the hub resolves, then
    // forwards to it for every request.
    if (config.RUNNER_HUB_ENABLED) {
      yield* Effect.tryPromise({
        try: () =>
          startRunnerHub({
            db,
            registry: machineRegistry,
            logger,
            port: config.RUNNER_HUB_PORT,
            gatewayUrl: config.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.map((hub) => {
          running.runnerHub = hub;
        }),
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.error(
              { err: errorMessage(error) },
              'runner hub failed to start; API continues without it',
            );
          }),
        ),
        Effect.forkDetach({ startImmediately: true }),
      );
    }

    // The gateway logs each AI in over XMPP, which can take a while when ejabberd
    // is slow or down: start it after the server is listening and never block on
    // it. Shutdown still awaits `gateway.stop()`, which is safe while a
    // start is in flight (sessions it no longer owns are dropped on connect).
    yield* Effect.tryPromise({ try: () => gateway.start(), catch: (error) => error }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const secrets =
            config.LITELLM_MASTER_KEY === undefined ? [] : [config.LITELLM_MASTER_KEY];
          const err = new Error(redactSecrets(errorMessage(error), secrets));
          if (error instanceof Error) {
            err.stack = redactSecrets(error.stack ?? '', secrets);
          }
          logger.error({ err }, 'agent gateway failed to start');
        }),
      ),
      Effect.forkDetach({ startImmediately: true }),
    );

    // Approvals sweeper (T-0087): starts after the edge server is listening so the API is
    // already listening, never blocks startup. The handle is held on `running`
    // for the shutdown sequence to close. The recorder wraps `recordAudit` so a
    // database write error never propagates into the timer.
    running.approvalsSweeper = startApprovalsSweeper({
      db,
      audit: createAuditRecorder({ db, logger }),
      logger,
    });

    // Action gateway recovery loop (T-0090): runs `recoverStuck` after one
    // interval and then every five minutes on an unref'd timer. The first
    // tick fires after the interval so startup is never blocked.
    running.recoveryStuck = startRecoveryStuckTimer({
      gateway: actionGateway,
      logger,
    });

    // One startup sweep: an earlier crash may have left `running` or
    // past-due `waiting` rows that we want to surface immediately rather than
    // wait up to five minutes for the first timer tick. Failure here logs
    // and carries on; the timer will retry on the next tick.
    yield* Effect.tryPromise({
      try: () => actionGateway.recoverStuck(),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.error({ err: errorMessage(error) }, 'initial recoverStuck sweep failed');
        }),
      ),
      Effect.forkDetach({ startImmediately: true }),
    );

    // Routines scheduler (T-0104): starts after the edge server is listening when
    // `ROUTINES_ENABLED=true`, with the gateway's `postToChat` (via the same
    // `running.gateway` the announcer uses). T-0105 wires the sandbox as
    // the runner: with the flag on but `TOOLS_ENABLED=false` the builder logs
    // its one warning and stays off; with both flags off it stays off
    // silently. Stops on shutdown like the other timers.
    running.routineScheduler = buildRoutineScheduler({
      db,
      routinesEnabled: config.ROUTINES_ENABLED,
      ...(toolRunner === undefined ? {} : { toolRunner }),
      audit: auditRecorder,
      logger,
      post,
    });
  });
}
