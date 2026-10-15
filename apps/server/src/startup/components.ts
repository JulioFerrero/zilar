// The second half of `startServer`: the components that build on the booted
// server (auth, registries, gateways), the HTTP listener, and the leader-only
// work behind the advisory lock. Kept separate from `boot.ts` so the fail-fast
// steps and the component wiring each stay readable.
import { Effect } from 'effect';
import { buildDemoEchoAdapter } from '../actions/demo';
import { type ActionAnnouncer, createActionGateway } from '../actions/gateway';
import { createProductionAnnouncer } from '../actions/production-announcer';
import { buildAlwaysEligible, buildRegistry } from '../actions/registry';
import { createAgentGateway } from '../agents/gateway';
import { createApp } from '../app';
import { createAuditRecorder } from '../audit/service';
import { createAuth } from '../auth/auth';
import { createKeyCipher } from '../connections/crypto';
import { sharedDraftHub } from '../drafts/hub';
import { serveEdgeOnNode } from '../effect/node-serve';
import { buildDeskProbe } from '../hands/wiring';
import { markLeader } from '../health-status';
import {
  createLeaderLock,
  createPostgresLockConnection,
  LEADER_LOCK_KEY,
  LEADER_LOCK_SCOPE,
  LEADER_POLL_MS,
} from '../leader/lock';
import { createLeaderWork } from '../leader/start';
import type { RunnerHub } from '../machines/hub';
import { createDbMachineRegistry } from '../machines/registry';
import { loadPushConfigOrExit, type PushConfig } from '../push/config';
import { runTool } from '../sandbox/run-tool';
import { createArchivePool } from '../search/service';
import { buildToolAdapters, type BuildToolAdaptersDeps } from '../tools/adapters';
import type { ToolRunner } from '../tools/types';
import { buildWebToolsAdapters } from '../web-tools/adapters';
import { createEjabberdAdminClient } from '../xmpp/admin-client';
import { startEjabberdSchemaCheck } from '../xmpp/schema-check';
import type { BootedServer } from './boot';
import { CONNECTION_GRACE_MS, type RunningServer } from './lifecycle';

/** Builds and starts the components, the HTTP listener and the leader lock. */
export function startComponents(boot: BootedServer, running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { config, logger, db, currentMailer } = boot;

    const adminClient = createEjabberdAdminClient(config.xmpp);
    const auth = createAuth({ db, config, mailer: currentMailer, adminClient, logger });

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
        ? buildWebToolsAdapters({ searchProviderName: config.WEB_SEARCH_PROVIDER, logger })
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

    // The archive pool is shared with push, search and the OPS-7 schema check.
    const archivePool =
      config.XMPP_ARCHIVE_DATABASE_URL === undefined
        ? undefined
        : startEjabberdSchemaCheck(createArchivePool(config.XMPP_ARCHIVE_DATABASE_URL), logger);
    // Push env (T-0119): separate from the server config so push stays optional.
    // An invalid PUSH_COMPONENT_HOST refuses to boot below (fixed message, no
    // value echoed) instead of dialling a broken URL — see push/config.ts.
    const push: PushConfig = yield* Effect.sync(() => loadPushConfigOrExit(process.env));

    // T-1425/T-1603: the cached desk probe, built once. The AI routes and the
    // gateway both read it: whether the desk agent answers ready decides if
    // Zilar cloud desks are offered.
    const deskProbe = buildDeskProbe(config, logger);

    const app = createApp({
      db,
      logger,
      config,
      auth,
      adminClient,
      ais: { cloud: async () => (await deskProbe()) !== null },
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
        desk: deskProbe,
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
