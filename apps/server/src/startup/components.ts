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
import { cardCorrectorOf } from '../message-blocks/api';
import type { CorrectCardInput } from '../message-blocks/respond';
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
import type { PromptRunner } from '../routines/execute-prompt';
import { runTool } from '../sandbox/run-tool';
import { createArchivePool } from '../search/service';
import { buildToolAdapters, type BuildToolAdaptersDeps } from '../tools/adapters';
import type { ToolRunner } from '../tools/types';
import { buildWebToolsAdapters } from '../web-tools/adapters';
import { createEjabberdAdminClient } from '../xmpp/admin-client';
import { startEjabberdSchemaCheck } from '../xmpp/schema-check';
import type { BootedServer } from './boot';
import { CONNECTION_GRACE_MS, type RunningServer } from './lifecycle';
import { postAsAi } from './post-as-ai';

export function startComponents(boot: BootedServer, running: RunningServer): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { config, logger, db, currentMailer } = boot;

    const adminClient = createEjabberdAdminClient(config.xmpp);
    const auth = createAuth({ db, config, mailer: currentMailer, adminClient, logger });

    // One registry shared with the machines routes and the hub, so approve/revoke notifies
    // reach the hub's listener set.
    const machineRegistry = createDbMachineRegistry(db);

    // The leader starts the hub later; this closure reads the holder each request.
    let runnerHub: RunnerHub | null = null;
    const isMachineOnline = (machineId: string): boolean => {
      return runnerHub?.isOnline(machineId) ?? false;
    };

    // One recorder wraps `recordAudit`, so a database write error never propagates into the
    // caller and every auditing route shares it.
    const auditRecorder = createAuditRecorder({ db, logger });

    // The action gateway is built before the agent gateway, so the announcer closes over a
    // `null` holder and resolves at runtime. With the gateway disabled it does nothing.
    const announcer: ActionAnnouncer = createProductionAnnouncer({
      db,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
      logger,
      getGateway: () => running.gateway,
    });

    // Posts as the AI through the agent gateway; `false` while it does not exist yet.
    const post: BuildToolAdaptersDeps['post'] = postAsAi(() => running.gateway);

    const runPrompt: PromptRunner = (input) => {
      const gateway = running.gateway;
      if (gateway === null) {
        return Promise.resolve('offline');
      }
      return gateway.runScheduledTurn(input);
    };

    const correctCard = (input: CorrectCardInput): Promise<boolean> =>
      cardCorrectorOf(running.gateway)?.correctInRoom(input) ?? Promise.resolve(false);

    // Production wires an empty adapter registry, so every action is denied
    // `unknown_action` until a real adapter is registered. The demo adapter exists only
    // with ACTION_DEMO_ENABLED=true to prove the flow end-to-end. When TOOLS_ENABLED=true
    // the real sandbox runner and the tool/routine adapters are added; when false, manual
    // runs answer 501 `runner_unavailable`. AI-written tool code runs in that sandbox.
    const toolRunner: ToolRunner | undefined = config.TOOLS_ENABLED
      ? (params) =>
          runTool({ source: params.source, input: params.input, allowedHosts: params.allowedHosts })
      : undefined;
    // With WEB_TOOLS_ENABLED=true the gateway-level web tools are registered next to the
    // tool adapters. They are separate from the sandbox: AI-written tools still fetch only
    // their approved hosts through `host-fetch`.
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

    const archivePool =
      config.XMPP_ARCHIVE_DATABASE_URL === undefined
        ? undefined
        : startEjabberdSchemaCheck(createArchivePool(config.XMPP_ARCHIVE_DATABASE_URL), logger);
    // Push env stays separate from the server config so push is optional. An invalid host
    // refuses to boot (fixed message, no value echoed).
    const push: PushConfig = yield* Effect.sync(() => loadPushConfigOrExit(process.env));

    // The cached desk probe, built once: whether the desk agent is ready decides if Zilar
    // cloud desks are offered.
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
      // A separate small pool on the ejabberd archive with a 3 s statement timeout; push
      // shares it to resolve who/where.
      ...(archivePool === undefined ? {} : { archive: archivePool }),
      push,
      ...(config.RUNNER_HUB_ENABLED ? { isMachineOnline } : {}),
      actionGateway,
      alwaysEligible,
      getGateway: () => running.gateway,
      // The same sandbox runner the adapters use; absent means manual runs answer 501.
      ...(toolRunner === undefined ? {} : { toolRunner }),
    });

    // Leader-only work starts through `createLeaderWork` once the advisory lock is held.
    // The agent gateway is off unless AGENT_GATEWAY_ENABLED=true and inert without the key
    // cipher; it connects each active AI to XMPP so owner DMs get replies.
    const gatewayCipher =
      config.ZILAR_KEY_ENCRYPTION_KEY === undefined
        ? undefined
        : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY);
    // The listener is a platform-paid feature and there is no platform key, so it is always
    // off; the flag stays so turning it on names the reason.
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
        // The gateway publishes drafts here; `/api/drafts/stream` streams them out.
        drafts: { hub: sharedDraftHub },
        actions: actionGateway,
        // The tool guide rides the system prompt only when tools are enabled; the loop runs
        // `AGENT_TOOL_MAX_ROUNDS` rounds (1 with tools off).
        toolsEnabled: config.TOOLS_ENABLED,
        toolMaxRounds: config.AGENT_TOOL_MAX_ROUNDS,
        desk: deskProbe,
        runnerDesk: () => runnerHub,
        cardMediaDir: boot.cardMediaDir,
      },
      { enabled: config.AGENT_GATEWAY_ENABLED },
    );
    running.gateway = gateway;

    // The Effect edge on its own server; `remoteAddress` comes from the real socket.
    const { port: boundPort, close: closeNodeServer } = yield* Effect.promise(() =>
      serveEdgeOnNode(app, {
        port: config.PORT,
        connectionGraceMs: CONNECTION_GRACE_MS,
      }),
    );
    running.closeHttp = closeNodeServer;
    logger.info({ port: boundPort }, 'zilar-server listening');

    // Everything from here on is leader-only: overlapping instances must not both run it.
    // `createLeaderWork` starts it on winning the lock and stops it on step down.
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
      runPrompt,
      correctCard,
      onRunnerHub: (hub) => {
        runnerHub = hub as RunnerHub | null;
      },
    });

    // If this dedicated lock connection drops while leader, the lock is gone: the lock logs
    // and exits so a restart comes back as a follower.
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
