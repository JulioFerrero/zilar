import { Effect } from 'effect';
import type { ChatCompletionMessage } from '../context';
import { revertPersonaFromChat, setPersonaFromChat } from '../../ais/service';
import { TOOL_GUIDE } from '../tool-guide';
import { looksLikeSecret } from '../memory/secrets';
import { addFact, recallMemory, zoomMemory } from '../memory/store';
import { type ExecuteToolCall, type ToolExecution, type ValidToolCall } from '../reply';
import {
  DELEGATE_TOOL,
  formatPersonaUpdatedLine,
  formatRememberedLine,
  MEMORY_ZOOM_TOOL,
  PERSONA_RESTORED_LINE,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
} from '../tools';
import { createDelegation, getDelegationForAi } from '../delegation/service';
import type { RequestOutcome } from '../../actions/gateway';
import {
  ROUND_MAX_HOPS,
  denialReasonForModel,
  errorName,
  formatModelText,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomRound,
} from './contracts';
import type { createLiveSession } from './live';
import type { RequestActionContext } from './group-turn';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0556 (plan §3, G4): the tool executor extracted from
// `createAgentGateway`. The factory takes the shared session maps, the live
// session check, the group room pump and the gateway callbacks the moved
// code closes over, and returns the same `executeToolCall`,
// `runRequestAction` and `withToolGuide` the DM and group turns take as
// ctx fields. A pure move: no logic or wording changed.
interface ToolExecContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  sessionIsLive: LiveSession['sessionIsLive'];
  pumpRoom: (session: AiSession, roomJid: string) => Promise<void>;
  secretsFor: (virtualKey?: string) => string[];
}

export function createToolExec(ctx: ToolExecContext) {
  const { deps, logger, sessions, roomRounds, sessionIsLive, pumpRoom, secretsFor } = ctx;

  // Runs one validated tool call against the gateway's own AI id. The id
  // comes from the session, never from the model's arguments, and the
  // `chatKey` comes from the turn. Only `ais.persona` /
  // `ais.previous_persona` (persona tools), the action gateway
  // (request_action) or this chat's memory rows (the memory tools) can
  // change. Log lines carry the AI id, the tool name and the outcome only:
  // never the persona text, a recall query, a block id or a fact.
  function executeToolCall(
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
  ): ExecuteToolCall {
    const aiId = session.aiId;
    // The T-0444 cap: at most five facts saved per turn. The counter lives in
    // this closure, which is created once per turn, so it resets with the
    // turn.
    let savedFacts = 0;
    const execute = Effect.fnUntraced(function* (
      call: ValidToolCall,
    ): Effect.fn.Return<ToolExecution> {
      // A turn that was computing when the AI was stopped must not change the
      // persona afterwards, and a tier-2 action must not run without the
      // owner's approval.
      if (!sessionIsLive(session)) {
        return { content: 'the AI was stopped' };
      }
      // A group turn offers the memory tools always, and `request_action`
      // only when the trigger is allowed to ask for one. The persona tools
      // are reachable from the owner's DM alone, so a model that improvises
      // one in a room (for example after reading a hostile message) gets
      // nothing.
      if (context !== undefined) {
        const isMemoryTool =
          call.tool === RECALL_TOOL ||
          call.tool === MEMORY_ZOOM_TOOL ||
          call.tool === REMEMBER_TOOL;
        // T-0482: `delegate` is offered only when this AI may delegate and at
        // least one accepting AI is in the room, and a model that improvises
        // it otherwise gets the same `invalid: unknown tool` as any other
        // unadvertised tool. `task_status` is always a known group tool: it
        // reads an existing row and `getDelegationForAi` already scopes the
        // read to the two involved AIs, so it must still fall through when
        // there are no delegation targets.
        const isDelegationTool = call.tool === DELEGATE_TOOL || call.tool === TASK_STATUS_TOOL;
        if (!isMemoryTool && !isDelegationTool && call.tool !== REQUEST_ACTION_TOOL) {
          return { content: 'invalid: unknown tool' };
        }
        if (call.tool === DELEGATE_TOOL && context.delegateTargetIds.size === 0) {
          return { content: 'invalid: unknown tool' };
        }
        if (call.tool === REQUEST_ACTION_TOOL && !context.allowActions) {
          return { content: 'invalid: unknown tool' };
        }
      }
      if (call.tool === RECALL_TOOL) {
        const lines = yield* Effect.promise(() => recallMemory(deps.db, aiId, chatKey, call.query));
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
        return { content: lines.length === 0 ? 'no matches' : lines.join('\n') };
      }
      if (call.tool === MEMORY_ZOOM_TOOL) {
        const lines = yield* Effect.promise(() => zoomMemory(deps.db, aiId, chatKey, call.block));
        if (lines === null) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'invalid: unknown block' };
        }
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
        return { content: lines.length === 0 ? 'empty' : lines.join('\n') };
      }
      if (call.tool === REMEMBER_TOOL) {
        if (savedFacts >= 5) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'refused: at most 5 per turn' };
        }
        if (looksLikeSecret(call.text)) {
          logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
          return { content: 'refused: looks like a secret' };
        }
        const outcome = yield* Effect.promise(() => addFact(deps.db, aiId, chatKey, call.text));
        if (outcome === 'saved') {
          savedFacts += 1;
          logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
          return { content: 'ok', notice: formatRememberedLine(call.text) };
        }
        logger.info({ aiId, tool: call.tool, ok: false }, 'AI memory tool');
        if (outcome === 'duplicate') {
          return { content: 'already remembered' };
        }
        return { content: 'invalid: one line, at most 280 characters' };
      }
      if (call.tool === DELEGATE_TOOL) {
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
      }
      if (call.tool === TASK_STATUS_TOOL) {
        // Only reachable in a group turn that offered the tool; a DM has no
        // delegation context, so an improvised call gets the same
        // `invalid: unknown tool` as any other unadvertised tool.
        if (context === undefined) {
          return { content: 'invalid: unknown tool' };
        }
        const view = yield* Effect.promise(() => getDelegationForAi(deps.db, call.taskId, aiId));
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
      }
      if (call.tool === UPDATE_PERSONA_TOOL) {
        yield* Effect.promise(() => setPersonaFromChat(deps.db, aiId, call.persona));
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona updated by chat');
        return { content: 'ok', notice: formatPersonaUpdatedLine(call.summary) };
      }
      if (call.tool === REQUEST_ACTION_TOOL) {
        if (context !== undefined) {
          // The triggering user's role may have changed during a long turn
          // (T-0098): re-check the database before calling the action
          // gateway, and short-circuit to `denied: not allowed` when they
          // are no longer an owner or admin. The gateway is never invoked
          // in that case, so no audit row is written and no card appears.
          const stillAllowed = yield* Effect.promise(() => context.isStillAllowed());
          if (!stillAllowed) {
            logger.info(
              { aiId: session.aiId, action: call.action, groupId: context.groupId },
              'AI request_action denied: sender no longer allowed',
            );
            return { content: 'denied: not allowed' };
          }
        }
        return yield* runRequestActionEffect(
          session,
          call,
          context === undefined
            ? undefined
            : { groupId: context.groupId, topicId: context.topicId },
        );
      }
      const outcome = yield* Effect.promise(() => revertPersonaFromChat(deps.db, aiId));
      logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona revert by chat');
      if (outcome === 'nothing to undo') {
        return { content: 'nothing to undo' };
      }
      return { content: 'ok', notice: PERSONA_RESTORED_LINE };
    });
    return (call) => Effect.runPromise(execute(call));
  }

  // Routes a `request_action` call into the action gateway. The ai id and
  // chat ids always come from the session, never from the call: a model
  // that smuggles `aiId` or `groupId` inside `args` cannot change who is
  // asked. The mapping below is the exact model-facing wording per
  // outcome (see spec); no adapter text beyond the success `summary`
  // reaches the AI. The group context (when present) adjusts the
  // pending-approval wording — owners see "in this chat", admins see "in
  // this room" — and tags the request with the room's group and topic ids.
  const runRequestActionEffect = Effect.fnUntraced(function* (
    session: AiSession,
    call: Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>,
    chat?: { groupId: string; topicId: string },
  ): Effect.fn.Return<ToolExecution> {
    const actions = deps.actions;
    if (actions === undefined) {
      // No action gateway wired: the tool was never offered, so this call
      // is treated as an unknown tool and answered honestly.
      return { content: 'invalid: unknown tool: request_action' };
    }
    const outcome = yield* Effect.promise(() =>
      actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
      }),
    ).pipe(
      Effect.catchDefect((error) =>
        // The gateway is best-effort: a thrown error here would mean a bug
        // we cannot leak. Log the class name only and answer as failed.
        Effect.sync((): RequestOutcome | null => {
          logger.warn(
            { err: errorName(error), aiId: session.aiId, action: call.action },
            'action gateway request threw',
          );
          return null;
        }),
      ),
    );
    if (outcome === null) {
      return { content: 'the action failed' };
    }
    switch (outcome.status) {
      case 'executed':
        return { content: `done: ${outcome.summary}${formatModelText(outcome.modelText)}` };
      case 'pending_approval':
        // The card message is the owner's view; the model just gets a
        // short fixed line so it knows to wait. The wording differs by
        // chat: in DMs the card appears in the owner's chat, in groups
        // it appears in the room and only group admins / owners / the
        // AI's owner get the buttons.
        return {
          content:
            chat === undefined
              ? "waiting for your owner's approval; a card was posted in this chat"
              : "waiting for an admin's approval; a card was posted in this room",
        };
      case 'failed':
        return { content: 'the action failed' };
      case 'denied':
        return { content: `denied: ${denialReasonForModel(outcome.reason)}` };
    }
  });

  const runRequestAction = (
    session: AiSession,
    call: Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>,
    chat?: { groupId: string; topicId: string },
  ): Promise<ToolExecution> => Effect.runPromise(runRequestActionEffect(session, call, chat));

  // T-0106: appends the fixed tool guide to the last user turn. The system
  // prompt builders take no options (their shape is frozen for provider
  // caching), so the guide rides as a separate user turn right before the
  // trigger. Only called when tools are enabled and adapters are
  // registered; otherwise the messages pass through untouched.
  function withToolGuide(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return [...messages, { role: 'user', content: TOOL_GUIDE }];
  }

  return { executeToolCall, runRequestAction, withToolGuide };
}
