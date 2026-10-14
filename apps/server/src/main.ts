// The server's startup and shutdown as Effect programs (T-0838). `index.ts`
// runs `serverProgram` with `NodeRuntime.runMain`; nothing else imports this
// file except its test.
//
// `startServer` builds the shared objects, starts the HTTP listener, then
// wires the leader lock (T-1316): the leader-only work lives in
// `leader/start.ts` and runs only on the instance that holds the Postgres
// advisory lock. `stopServer` follows the zero-downtime order below (drain,
// step down the leader, close HTTP, then the SQL runtime and the lock).
//
// `serverProgram` holds ONE scope finalizer, registered before startup begins:
// `runMain` interrupts the main fiber on SIGINT/SIGTERM, the scope closes, and
// the finalizer runs `stopServer` under the force-exit.
import { Cause, Effect, Exit, Fiber, Runtime } from 'effect';
import type { Logger } from 'pino';
import { createProductionAnnouncer } from './actions/production-announcer';
import { buildDemoEchoAdapter } from './actions/demo';
import { type ActionAnnouncer, createActionGateway } from './actions/gateway';
import { buildAlwaysEligible, buildRegistry } from './actions/registry';
import { createAgentGateway, type AgentGateway } from './agents/gateway';
import { createApp } from './app';
import { serveEdgeOnNode } from './effect/node-serve';
import { resolveStorageDir } from './stickers/service';
import { createAuditRecorder } from './audit/service';
import { markDraining, markLeader } from './health-status';
import {
  createLeaderLock,
  createPostgresLockConnection,
  LEADER_LOCK_KEY,
  LEADER_LOCK_SCOPE,
  LEADER_POLL_MS,
  type LeaderLock,
} from './leader/lock';
import { createLeaderWork } from './leader/start';
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
import { loadPushConfigOrExit, type PushConfig } from './push/config';
import { sharedDraftHub } from './drafts/hub';
import { createLogger } from './logger';
import { assertRunnerHubConfig, DEFAULT_MODEL_GATEWAY_URL, type RunnerHub } from './machines/hub';
import { createDbMachineRegistry } from './machines/registry';
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
import { buildDeskClient } from './hands/wiring';

// How long open connections (SSE streams) get before they are closed, and the
// point at which a stuck shutdown gives up and exits.
export const CONNECTION_GRACE_MS = 3_000;
export const FORCE_EXIT_MS = 15_000;

/**
 * The handles `stopServer` closes. `startServer` fills each field as soon as
 * the thing it names exists, so a stop that begins during startup closes
 * exactly what was started. The leader-only work lives behind `leader`; a
 * follower has nothing there to stop beyond releasing the lock.
 */
export interface RunningServer {
  logger: Logger | null;
  db: ServerDatabase | null;
  closeDb: (() => Promise<void>) | null;
  closeHttp: (() => Promise<void>) | null;
  gateway: Pick<AgentGateway, 'stop' | 'postToChat' | 'stopTurn'> | null;
  leader: Pick<LeaderLock, 'stepDown' | 'close'> | null;
  /** How long to keep serving (health 503) before stepping down. 0 in tests. */
  drainMs: number;
}

export function emptyRunning(): RunningServer {
  return {
    logger: null,
    db: null,
    closeDb: null,
    closeHttp: null,
    gateway: null,
    leader: null,
    drainMs: 0,
  };
}

/**
 * Shuts the server down in the zero-downtime order (T-1316): mark draining so
 * `/health` answers 503, keep serving for `drainMs` so Traefik stops routing
 * here while in-flight requests finish, stop the leader-only work and release
 * the advisory lock (so the new instance takes over), then close HTTP, the SQL
 * runtime and the database, and finally the lock connection. A step that fails
 * ends the sequence, like the old sequential awaits.
 */
export function stopServer(running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { leader, closeHttp, db, closeDb } = running;
    markDraining();
    if (running.drainMs > 0) {
      yield* Effect.sleep(running.drainMs);
    }
    if (leader !== null) {
      yield* Effect.promise(() => leader.stepDown());
    }
    if (closeHttp !== null) {
      yield* Effect.promise(() => closeHttp());
    }
    // The `effect/sql` runtime owns the database pool: dispose it. `closeDb`
    // is the no-op from `createDb`, kept so the shutdown path reads the same.
    if (db !== null) {
      yield* Effect.promise(() => disposeSqlRuntime(db));
    }
    if (closeDb !== null) {
      yield* Effect.promise(() => closeDb());
    }
    if (leader !== null) {
      yield* Effect.promise(() => leader.close());
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
      gatewayUrl: DEFAULT_MODEL_GATEWAY_URL,
    });

    // One registry, shared with both the machines routes and the hub: the
    // route's approve/revoke notifies must reach the hub's listener set.
    const machineRegistry = createDbMachineRegistry(db);

    // The leader starts the runner hub later; the closure reads this holder
    // each request, so the routes pick up the hub once `startRunnerHub`
    // resolves. Null when this instance is a follower, so `online: false`.
    let runnerHub: RunnerHub | null = null;
    const isMachineOnline = (machineId: string): boolean => {
      return runnerHub?.isOnline(machineId) ?? false;
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

    // T-1425: built here so the AI routes can report whether Zilar cloud desks
    // are available (`desk !== null`); the gateway below reuses the same value.
    const desk = buildDeskClient(config, logger);

    const app = createApp({
      db,
      logger,
      config,
      auth,
      adminClient,
      ais: { cloud: desk !== null },
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
      // T-1422: the agent gateway is built below; the stop-turn route reads it
      // lazily, and answers `stopped: false` while it is still null.
      getGateway: () => running.gateway,
      // T-0105: the same sandbox runner the adapters use. Absent = manual
      // runs answer 501 `runner_unavailable`.
      ...(toolRunner === undefined ? {} : { toolRunner }),
    });

    // The push component, room reconcile and group notifier are leader-only;
    // they start through `createLeaderWork` once the advisory lock is held.
    // Agent gateway (T-0034): off unless AGENT_GATEWAY_ENABLED=true, and inert
    // without the key cipher. It connects each active AI to XMPP so owner DMs
    // get replies; each turn calls the AI's own provider connection.
    const gatewayCipher =
      config.ZILAR_KEY_ENCRYPTION_KEY === undefined
        ? undefined
        : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY);
    // T-1399: the listener is a platform-paid feature and there is no platform
    // key in P0, so it is always off. The flag stays so turning it on names the
    // reason instead of silently doing nothing.
    if (config.LISTENER_ENABLED) {
      logger.warn(
        'listener is off until AIs can pay for their own model calls; ignoring LISTENER_ENABLED',
      );
    }
    const gateway = createAgentGateway(
      {
        db,
        xmpp: config.xmpp,
        adminClient,
        ...(gatewayCipher === undefined ? {} : { cipher: gatewayCipher }),
        ...(archivePool === undefined ? {} : { archive: archivePool }),
        logger,
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
        ...(desk === null ? {} : { desk }),
        // T-1423: the runner hub, read lazily because it starts after this.
        runnerDesk: () => runnerHub,
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

    // Everything from here on is leader-only: the two overlapping instances
    // during a rolling deploy must not both run it (T-1316). `createLeaderWork`
    // starts it when this instance wins the advisory lock and stops it on step
    // down; the HTTP routes and per-request work above stay on every instance.
    const leaderWork = createLeaderWork({
      db,
      config,
      logger,
      adminClient,
      archivePool,
      push,
      machineRegistry,
      gateway,
      actionGateway,
      audit: auditRecorder,
      toolRunner,
      post,
      onRunnerHub: (hub) => {
        runnerHub = hub as RunnerHub | null;
      },
    });

    // One dedicated connection holds the session-level advisory lock; the
    // second instance polls every second until the first steps down. If this
    // connection drops while leader, the lock is gone: the lock logs and exits
    // so a restart comes back as a follower (audit §3).
    const leader = createLeaderLock({
      connection: createPostgresLockConnection({
        url: config.DATABASE_URL,
        scope: LEADER_LOCK_SCOPE,
        key: LEADER_LOCK_KEY,
      }),
      logger,
      pollMs: LEADER_POLL_MS,
      onAcquire: async () => {
        markLeader(true);
        await leaderWork.start();
      },
      onStepDown: async () => {
        await leaderWork.stop();
        markLeader(false);
      },
    });
    running.leader = leader;
    running.drainMs = config.SHUTDOWN_DRAIN_MS;
    leader.start();
  });
}
