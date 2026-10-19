import type { ServerCore } from '../app/deps';

import { redactSecrets } from '../ai/http';
import {
  type ActionGateway,
  startRecoveryStuckTimer,
  type RecoveryStuckHandle,
} from '../actions/gateway';
import { type AgentGateway } from '../agents/gateway';
import { initTopicFollow } from '../agents/gateway/topic-follow';
import { startTaskEventRetention, type TaskEventRetentionHandle } from '../agents/log/retention';

import { type ServerDatabase } from '../db/client';
import { startRunnerHub, type RunnerHub } from '../machines/hub';
import { type DbMachineRegistry } from '../machines/registry';
import { type CorrectCardInput } from '../message-blocks/respond';
import { startPushComponent, type PushComponentHandle } from '../push/component';
import { pushConfigError, type PushConfig } from '../push/config';
import { createPushCipher } from '../push/crypto';
import { startGroupNotifier } from '../push/group-notifier';
import { createNativeSender } from '../push/native-sender';
import { createWebPushSender } from '../push/sender';
import { type PromptRunner } from '../routines/execute-prompt';
import { type ArchivePool } from '../search/service';
import { type BuildToolAdaptersDeps } from '../tools/adapters';
import { type ToolRunner } from '../tools/types';
import { reconcileRoomSubscriptionOptions, syncTopicRoom } from '../topics/rooms';

import { type Payload } from '@zilar/protocol';
import { defaultSleep, type ExecuteRoutinePorts } from '../routines/execute';
import {
  createRoutineScheduler,
  type RoutineLogger,
  type RoutineSchedulerHandle,
} from '../routines/scheduler';
import { type AuditEntry } from '../audit/schema';
import { startSweepLoop } from '../effect/sweep-loop';
import { expireStale } from '../approvals/service';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { errorClassName, messageOf, serializeError } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { type TopicRow } from '../topics/access';
import { type InviteLogger } from '../groups/schemas';
interface RoomReconcileLogger extends InviteLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
}

interface RoomReconcileDeps extends Pick<ServerCore, 'db' | 'adminClient'> {
  domain: string;
  logger: RoomReconcileLogger;
  signal?: AbortSignal;
  pauseMs?: number;
}

// About three rooms per second keeps the admin API and ejabberd calm.
const DEFAULT_PAUSE_MS = 350;

const PRIVATE_ROOM_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['members_only', 'true'],
  ['public', 'false'],
  ['public_list', 'false'],
];

async function liveTopics(db: ServerDatabase): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE archived_at IS NULL`;
    }),
  );
  return [...rows];
}

async function reconcileRoom(deps: RoomReconcileDeps, topic: TopicRow): Promise<boolean> {
  try {
    await syncTopicRoom(
      { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
      topic,
    );
    for (const [option, value] of PRIVATE_ROOM_OPTIONS) {
      await deps.adminClient.changeRoomOption(topic.roomLocalpart, option, value);
    }
    return true;
  } catch (error) {
    deps.logger.warn(
      { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
      'could not reconcile a room',
    );
    return false;
  }
}

// Once per leader start, re-sync every live group and topic room:
// `syncTopicRoom` re-applies the plain `member` affiliations, then the room
// options. Idempotent, throttled, one summary line; a failure is logged by
// localpart and never stops the pass. Archived topics re-sync on removal.
async function reconcileRoomRights(deps: RoomReconcileDeps): Promise<void> {
  const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
  const topics = await liveTopics(deps.db);
  let reconciled = 0;
  let failed = 0;
  for (const topic of topics) {
    if (deps.signal?.aborted) {
      break;
    }
    if (await reconcileRoom(deps, topic)) {
      reconciled += 1;
    } else {
      failed += 1;
    }
    await defaultSleep(pauseMs);
  }
  deps.logger.info(
    { rooms: topics.length, reconciled, failed, interrupted: deps.signal?.aborted === true },
    'room rights reconcile finished',
  );
}

// The minimum slice of pino's Logger the sweeper needs.
export interface SweeperLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

interface StartApprovalsSweeperOptions {
  db: ServerDatabase;
  /** Each swept row writes exactly one `approval.expired` entry. */
  audit: { record: (entry: AuditEntry) => Promise<void> };
  logger: SweeperLogger;
  /** Tick cadence in milliseconds. Defaults to 60 s. */
  intervalMs?: number;
  now?: () => Date;
}

interface ApprovalsSweeperHandle {
  close(): void;
}

// `expireStale`'s conditional update makes racing sweeps safe: the second sees
// an empty `RETURNING`.
export function startApprovalsSweeper({
  db,
  audit,
  logger,
  intervalMs = 60_000,
  now = () => new Date(),
}: StartApprovalsSweeperOptions): ApprovalsSweeperHandle {
  async function tick(): Promise<void> {
    const at = now();
    let swept: Array<{ id: string; aiId: string; groupId: string | null }>;
    try {
      swept = await expireStale(db, at);
    } catch (error) {
      // No row or AI ids in the log; the next successful tick brings the data.
      logger.error({ err: serializeError(error) }, 'approvals sweeper tick failed');
      return;
    }
    for (const row of swept) {
      try {
        await audit.record({
          action: 'approval.expired',
          actorUserId: null,
          aiId: row.aiId,
          groupId: row.groupId,
          subjectId: row.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'denied',
          detail: null,
        });
      } catch (error) {
        logger.error({ err: serializeError(error) }, 'approvals sweeper audit write failed');
      }
    }
  }

  // First run after one interval, not at boot, so the delay never blocks startup.
  return startSweepLoop(intervalMs, tick);
}

interface BuildRoutineSchedulerDeps extends Pick<ServerCore, 'db' | 'audit'> {
  routinesEnabled: boolean;
  // Absent = no runner, so the scheduler stays off.
  toolRunner?: ToolRunner;
  // Posts as the AI (`postToChat` via the `gatewayRef` closure).
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  // Runs a prompt routine through the gateway; absent while the gateway is null, so the run is `skipped`.
  runPrompt?: PromptRunner;
  // Corrects a linked alert card in the room (`correctInRoom`).
  correctCard?: ExecuteRoutinePorts['correctCard'];
  logger: RoutineLogger;
}

// Returns a started handle, or null; the single warning covers flag on with no runner.
function buildRoutineScheduler(deps: BuildRoutineSchedulerDeps): RoutineSchedulerHandle | null {
  if (!deps.routinesEnabled) {
    return null;
  }
  if (deps.toolRunner === undefined) {
    deps.logger.warn(
      {},
      'ROUTINES_ENABLED=true but no tool runner is configured; the routines scheduler stays off',
    );
    return null;
  }
  const handle = createRoutineScheduler({
    db: deps.db,
    runTool: deps.toolRunner,
    post: deps.post,
    ...(deps.runPrompt === undefined ? {} : { runPrompt: deps.runPrompt }),
    ...(deps.correctCard === undefined ? {} : { correctCard: deps.correctCard }),
    audit: deps.audit,
    logger: deps.logger,
  });
  handle.start();
  return handle;
}

export interface LeaderWorkDeps extends Pick<
  ServerCore,
  'db' | 'config' | 'logger' | 'adminClient' | 'audit'
> {
  archivePool: ArchivePool | undefined;
  push: PushConfig;
  machineRegistry: DbMachineRegistry;
  gateway: Pick<AgentGateway, 'start' | 'stop'>;
  actionGateway: ActionGateway;
  toolRunner: ToolRunner | undefined;
  post: BuildToolAdaptersDeps['post'];
  runPrompt: PromptRunner;
  correctCard: (input: CorrectCardInput) => Promise<boolean>;
  onRunnerHub: (hub: Pick<RunnerHub, 'isOnline' | 'close'> | null) => void;
}

export interface LeaderWork {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createLeaderWork(deps: LeaderWorkDeps): LeaderWork {
  const { db, config, logger } = deps;
  let runnerHub: RunnerHub | null = null;
  let pushComponent: Pick<PushComponentHandle, 'stop'> | null = null;
  let approvalsSweeper: ApprovalsSweeperHandle | null = null;
  let taskEventRetention: TaskEventRetentionHandle | null = null;
  let recoveryStuck: RecoveryStuckHandle | null = null;
  let routineScheduler: RoutineSchedulerHandle | null = null;
  let roomReconcile: AbortController | null = null;

  // Push: off unless PUSH_ENABLED=true. A misconfigured flag or a missing archive pool
  // logs one error and stays off. A start failure never takes the API down; the component
  // reconnects on its own and `stop` still stops it.
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
      pushComponent = {
        stop: () => Promise.all([component.stop(), groupNotifier.stop()]).then(() => {}),
      };
    } catch (error) {
      logger.error(
        { err: messageOf(error) },
        'push component failed to start; API continues without it',
      );
    }
    // One-time reconcile for older rooms: enable `allow_subscription` through
    // `change_room_option`. Best effort, failures logged per room.
    void reconcileRoomSubscriptionOptions({ db, adminClient: deps.adminClient, logger }).catch(
      (error: unknown) => {
        logger.warn({ error: messageOf(error) }, 'push room reconcile failed');
      },
    );
  }

  // Runner hub: off unless RUNNER_HUB_ENABLED=true. A start failure must never take the
  // API down; `isMachineOnline` returns false until the hub resolves.
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

  // One pass per leader start that moves existing rooms to the hardened rights. Best
  // effort and throttled; step-down aborts it.
  function startRoomRightsReconcile(): void {
    const controller = new AbortController();
    roomReconcile = controller;
    void reconcileRoomRights({
      db,
      adminClient: deps.adminClient,
      domain: config.xmpp.domain,
      logger,
      signal: controller.signal,
    }).catch((error: unknown) => {
      logger.warn({ error: messageOf(error) }, 'room rights reconcile failed');
    });
  }

  // The gateway logs each AI in over XMPP, which can be slow: never block on it. Shutdown
  // still awaits `gateway.stop()`, safe while a start is in flight.
  function startGatewayWork(): void {
    void deps.gateway.start().catch((error: unknown) => {
      // The generic credential rule still strips any provider key a start failure might echo.
      const err = new Error(redactSecrets(messageOf(error), []));
      if (error instanceof Error) {
        err.stack = redactSecrets(error.stack ?? '', []);
      }
      logger.error({ err }, 'agent gateway failed to start');
    });
  }

  // One startup sweep: surface `running` or past-due `waiting` rows immediately rather
  // than wait up to five minutes for the first timer tick.
  function recoverStuckOnce(): void {
    void deps.actionGateway.recoverStuck().catch((error: unknown) => {
      logger.error({ err: messageOf(error) }, 'initial recoverStuck sweep failed');
    });
  }

  return {
    async start(): Promise<void> {
      startPush();
      startRunnerHubWork();
      startRoomRightsReconcile();
      // Reload the saved Stop pauses before the gateway reads them. A failed load is
      // logged and ignored: following resumes until the next Stop.
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
    async stop(): Promise<void> {
      roomReconcile?.abort();
      roomReconcile = null;
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
