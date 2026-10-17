// effect-plain: the leader-only background work, moved from main.ts (T-1316,
// docs/audit/two-servers-audit.md §3). Plain async start/stop handles for the
// same components main.ts started before; a follower never runs them.
//
// `startServer` builds the shared objects (db, app, gateway) and hands them
// here; `createLeaderLock` calls `start()` when this instance wins the advisory
// lock and `stop()` when it steps down (or shuts down).
import type { Logger } from 'pino';
import { redactSecrets } from '../ai/http';
import type { ActionGateway } from '../actions/gateway';
import { startRecoveryStuckTimer, type RecoveryStuckHandle } from '../actions/gateway';
import type { AgentGateway } from '../agents/gateway';
import { initTopicFollow } from '../agents/gateway/topic-follow';
import { startApprovalsSweeper, type ApprovalsSweeperHandle } from '../approvals/sweeper';
import { startTaskEventRetention, type TaskEventRetentionHandle } from '../agents/log/retention';
import type { AuditRecorder } from '../audit/service';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { startRunnerHub, type RunnerHub } from '../machines/hub';
import type { DbMachineRegistry } from '../machines/registry';
import type { CorrectCardInput } from '../message-blocks/respond';
import { startPushComponent, type PushComponentHandle } from '../push/component';
import { pushConfigError, type PushConfig } from '../push/config';
import { createPushCipher } from '../push/crypto';
import { startGroupNotifier } from '../push/group-notifier';
import { createNativeSender } from '../push/native-sender';
import { createWebPushSender } from '../push/sender';
import { buildRoutineScheduler, type RoutineSchedulerHandle } from '../routines/wiring';
import type { PromptRunner } from '../routines/execute-prompt';
import type { ArchivePool } from '../search/service';
import type { BuildToolAdaptersDeps } from '../tools/adapters';
import type { ToolRunner } from '../tools/types';
import { reconcileRoomSubscriptionOptions } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin/types';

export interface LeaderWorkDeps {
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  adminClient: EjabberdAdminClient;
  archivePool: ArchivePool | undefined;
  push: PushConfig;
  machineRegistry: DbMachineRegistry;
  gateway: Pick<AgentGateway, 'start' | 'stop'>;
  actionGateway: ActionGateway;
  audit: AuditRecorder;
  toolRunner: ToolRunner | undefined;
  post: BuildToolAdaptersDeps['post'];
  /** Runs a prompt routine through the gateway; the scheduler records
   * `skipped` while it is absent. */
  runPrompt: PromptRunner;
  /** T-1880: corrects a linked alert card in the room; `false` while the
   * gateway does not exist yet. */
  correctCard: (input: CorrectCardInput) => Promise<boolean>;
  /**
   * Called with the runner hub while it runs and with `null` when it stops, so
   * the per-request `isMachineOnline` closure follows the leader.
   */
  onRunnerHub: (hub: Pick<RunnerHub, 'isOnline' | 'close'> | null) => void;
}

export interface LeaderWork {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLeaderWork(deps: LeaderWorkDeps): LeaderWork {
  const { db, config, logger } = deps;
  let runnerHub: RunnerHub | null = null;
  let pushComponent: Pick<PushComponentHandle, 'stop'> | null = null;
  let approvalsSweeper: ApprovalsSweeperHandle | null = null;
  let taskEventRetention: TaskEventRetentionHandle | null = null;
  let recoveryStuck: RecoveryStuckHandle | null = null;
  let routineScheduler: RoutineSchedulerHandle | null = null;

  // Push component (T-0119): off unless PUSH_ENABLED=true. A misconfigured flag
  // (keys, component credentials or storage key missing) logs one error and
  // stays off; without the archive pool it also stays off, because the
  // component could not resolve who/where and would have to guess. A start
  // failure never takes the API down: the component reconnects on its own and
  // `stop` still stops it.
  function startPush(): void {
    if (!deps.push.PUSH_ENABLED) {
      logger.info('push is disabled (PUSH_ENABLED=false)');
      return;
    }
    const pushError = pushConfigError(deps.push);
    if (pushError !== null) {
      logger.error({ err: pushError }, 'push stays off');
      return;
    }
    const { archivePool } = deps;
    if (archivePool === undefined) {
      logger.error(
        'push stays off: XMPP_ARCHIVE_DATABASE_URL is not set, so notifications could not be resolved',
      );
      return;
    }
    try {
      const sender = createWebPushSender({
        PUSH_VAPID_PUBLIC_KEY: deps.push.PUSH_VAPID_PUBLIC_KEY as string,
        PUSH_VAPID_PRIVATE_KEY: deps.push.PUSH_VAPID_PRIVATE_KEY as string,
        PUSH_VAPID_SUBJECT: deps.push.PUSH_VAPID_SUBJECT as string,
      });
      const nativeSender = createNativeSender(deps.push, logger);
      const cipher = createPushCipher(deps.push.PUSH_STORAGE_KEY as string);
      const service = {
        db,
        config,
        archive: archivePool,
        cipher,
        sender,
        ...(nativeSender === undefined ? {} : { nativeSender }),
        logger,
        recentlyNotified: new Map<string, Set<string>>(),
      };
      const groupNotifier = startGroupNotifier({ service, admin: deps.adminClient, logger });
      const component = startPushComponent({
        domain: deps.push.PUSH_COMPONENT_JID as string,
        secret: deps.push.PUSH_COMPONENT_SECRET as string,
        host: deps.push.PUSH_COMPONENT_HOST,
        port: deps.push.PUSH_COMPONENT_PORT,
        service,
        logger,
      });
      // Starts next to the component; stops with it, one handle.
      pushComponent = {
        stop: () => Promise.all([component.stop(), groupNotifier.stop()]).then(() => {}),
      };
    } catch (error) {
      logger.error(
        { err: messageOf(error) },
        'push component failed to start; API continues without it',
      );
    }
    // One-time reconcile for rooms created before push: enable
    // `allow_subscription` through `change_room_option`. Best effort —
    // failures are logged per room inside. Fire-and-forget, as the old
    // detached Effect fiber was.
    void reconcileRoomSubscriptionOptions({ db, adminClient: deps.adminClient, logger }).catch(
      (error: unknown) => {
        logger.warn({ error: messageOf(error) }, 'push room reconcile failed');
      },
    );
  }

  // Runner hub (T-0071): starts only when RUNNER_HUB_ENABLED=true. A start
  // failure (port in use, bad config) must never take the API down, so it logs
  // and the rest of the server keeps running. `isMachineOnline` returns false
  // until the hub resolves, then forwards to it for every request.
  function startRunnerHubWork(): void {
    if (!config.RUNNER_HUB_ENABLED) {
      return;
    }
    void startRunnerHub({
      db,
      registry: deps.machineRegistry,
      logger,
      port: config.RUNNER_HUB_PORT,
    })
      .then((hub) => {
        runnerHub = hub;
        deps.onRunnerHub(hub);
      })
      .catch((error: unknown) => {
        logger.error(
          { err: messageOf(error) },
          'runner hub failed to start; API continues without it',
        );
      });
  }

  // The gateway logs each AI in over XMPP, which can take a while when ejabberd
  // is slow or down: never block on it. Shutdown still awaits `gateway.stop()`,
  // which is safe while a start is in flight (sessions it no longer owns are
  // dropped on connect).
  function startGatewayWork(): void {
    void deps.gateway.start().catch((error: unknown) => {
      // The generic credential rule still strips any provider key a start
      // failure might echo.
      const err = new Error(redactSecrets(messageOf(error), []));
      if (error instanceof Error) {
        err.stack = redactSecrets(error.stack ?? '', []);
      }
      logger.error({ err }, 'agent gateway failed to start');
    });
  }

  // One startup sweep: an earlier crash may have left `running` or past-due
  // `waiting` rows that we want to surface immediately rather than wait up to
  // five minutes for the first timer tick. Failure here logs and carries on;
  // the timer retries on the next tick.
  function recoverStuckOnce(): void {
    void deps.actionGateway.recoverStuck().catch((error: unknown) => {
      logger.error({ err: messageOf(error) }, 'initial recoverStuck sweep failed');
    });
  }

  return {
    async start(): Promise<void> {
      startPush();
      startRunnerHubWork();
      // T-1493: reload the saved Stop pauses before the gateway reads them. A
      // failed load is logged and ignored: following simply resumes until the
      // next Stop, which is better than never starting the gateway.
      await initTopicFollow(db).catch((error: unknown) => {
        logger.error({ err: messageOf(error) }, 'saved topic follow pauses failed to load');
      });
      startGatewayWork();
      approvalsSweeper = startApprovalsSweeper({ db, audit: deps.audit, logger });
      taskEventRetention = startTaskEventRetention({ db, logger });
      recoveryStuck = startRecoveryStuckTimer({ gateway: deps.actionGateway, logger });
      recoverStuckOnce();
      routineScheduler = buildRoutineScheduler({
        db,
        routinesEnabled: config.ROUTINES_ENABLED,
        ...(deps.toolRunner === undefined ? {} : { toolRunner: deps.toolRunner }),
        audit: deps.audit,
        logger,
        post: deps.post,
        runPrompt: deps.runPrompt,
        correctCard: deps.correctCard,
      });
    },
    // Today's stop order (main.ts): runner hub, push, the agent gateway, the
    // two timers and the routine scheduler.
    async stop(): Promise<void> {
      if (runnerHub !== null) {
        await runnerHub.close();
        runnerHub = null;
        deps.onRunnerHub(null);
      }
      if (pushComponent !== null) {
        await pushComponent.stop();
        pushComponent = null;
      }
      await deps.gateway.stop();
      approvalsSweeper?.close();
      approvalsSweeper = null;
      taskEventRetention?.close();
      taskEventRetention = null;
      recoveryStuck?.close();
      recoveryStuck = null;
      routineScheduler?.stop();
      routineScheduler = null;
    },
  };
}
