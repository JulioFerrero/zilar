import { Effect } from 'effect';
import { createDelegation, getDelegationForAi } from '../delegation/service';
import type { ToolExecution, ValidToolCall } from '../tool-loop';
import { DELEGATE_TOOL, TASK_STATUS_TOOL } from '../tools/schemas';
import {
  ROUND_MAX_HOPS,
  errorName,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomRound,
} from './contracts';
import type { RequestActionContext } from './group-turn';

type DelegateCall = Extract<ValidToolCall, { tool: typeof DELEGATE_TOOL }>;
type TaskStatusCall = Extract<ValidToolCall, { tool: typeof TASK_STATUS_TOOL }>;

interface DelegateRunnerContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  pumpRoom: (session: AiSession, roomJid: string) => Promise<void>;
  secretsFor: (secret?: string) => string[];
}

export function createDelegateRunner(ctx: DelegateRunnerContext) {
  const { deps, logger, sessions, roomRounds, pumpRoom, secretsFor } = ctx;

  const runDelegate = Effect.fnUntraced(function* (
    session: AiSession,
    context: RequestActionContext | undefined,
    call: DelegateCall,
  ): Effect.fn.Return<ToolExecution> {
    // Only reachable in a group turn that offered the tool; the guard
    // above answers `invalid: unknown tool` otherwise.
    if (context === undefined) {
      return { content: 'invalid: unknown tool' };
    }
    if (!context.delegateTargetIds.has(call.toAiId)) {
      return { content: 'invalid: unknown AI' };
    }
    // The target must still be a live session in this room. The id set was
    // built from those sessions at turn start, so a session that left in
    // the meantime is refused the same way an unknown id is.
    let worker: AiSession | undefined;
    for (const candidate of sessions.values()) {
      if (candidate.aiId === call.toAiId && candidate.rooms.has(context.roomJid)) {
        worker = candidate;
        break;
      }
    }
    if (worker === undefined) {
      return { content: 'invalid: unknown AI' };
    }
    const round = roomRounds.get(context.roomJid);
    if (round !== undefined && round.hops >= ROUND_MAX_HOPS) {
      logger.info(
        { fromAiId: session.aiId, toAiId: call.toAiId, groupId: context.groupId },
        'AI delegation refused: no hops left',
      );
      return { content: 'refused: no hops left for this message' };
    }
    const bossNick = session.rooms.get(context.roomJid)?.nick ?? '';
    const created = yield* Effect.promise(() =>
      createDelegation(deps.db, {
        fromAiId: session.aiId,
        toAiId: call.toAiId,
        groupId: context.groupId,
        ...(context.topicId === '' ? {} : { topicId: context.topicId }),
        objective: call.objective,
        ...(call.contextSummary === undefined ? {} : { contextSummary: call.contextSummary }),
        ...(call.acceptance === undefined ? {} : { acceptance: call.acceptance }),
        ...(call.returnFormat === undefined ? {} : { returnFormat: call.returnFormat }),
        replyTo: context.triggerId,
      }),
    ).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => {
          logger.warn(
            { err: errorName(error), fromAiId: session.aiId, toAiId: call.toAiId },
            'AI delegation create threw',
          );
          return null;
        }),
      ),
    );
    if (created === null) {
      return { content: 'the task could not be started' };
    }
    if (!created.ok) {
      logger.info(
        { fromAiId: session.aiId, toAiId: call.toAiId, groupId: context.groupId, ok: false },
        'AI delegation refused',
      );
      return { content: `refused: ${created.reason}` };
    }
    let body = `Task from ${bossNick}: ${call.objective}`;
    if (call.contextSummary !== undefined) {
      body += `\nContext: ${call.contextSummary}`;
    }
    if (call.returnFormat !== undefined) {
      body += `\nReturn: ${call.returnFormat}`;
    }
    const queued = worker.roomPending.get(context.roomJid) ?? [];
    queued.push({
      id: `delegation:${created.delegation.id}`,
      body,
      fromJid: session.aiJid,
      fromResolved: true,
      ...(bossNick === '' ? {} : { fromNick: bossNick }),
      timestamp: (deps.now ?? (() => new Date()))(),
      handoff: true,
      delegationId: created.delegation.id,
    });
    worker.roomPending.set(context.roomJid, queued);
    const pumpedWorker = worker;
    Effect.runFork(
      Effect.promise(() => pumpRoom(pumpedWorker, context.roomJid)).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: pumpedWorker.aiId },
              'AI group pump failed',
            );
          }),
        ),
      ),
    );
    if (round !== undefined) {
      round.hops += 1;
    }
    logger.info(
      {
        fromAiId: session.aiId,
        toAiId: call.toAiId,
        delegationId: created.delegation.id,
        groupId: context.groupId,
      },
      'AI delegation started',
    );
    return {
      content: JSON.stringify({ task_id: created.delegation.id, status: 'working' }),
    };
  });

  const runTaskStatus = Effect.fnUntraced(function* (
    session: AiSession,
    context: RequestActionContext | undefined,
    call: TaskStatusCall,
  ): Effect.fn.Return<ToolExecution> {
    if (context === undefined) {
      return { content: 'invalid: unknown tool' };
    }
    const view = yield* Effect.promise(() =>
      getDelegationForAi(deps.db, call.taskId, session.aiId),
    );
    if (view === null) {
      return { content: 'invalid: unknown task' };
    }
    return {
      content: JSON.stringify({
        task_id: view.id,
        status: view.status,
        result: view.resultSummary,
      }),
    };
  });

  return { runDelegate, runTaskStatus };
}
