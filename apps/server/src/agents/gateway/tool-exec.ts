import { Effect } from 'effect';
import type { ChatCompletionMessage } from '../context';
import { revertPersonaFromChat, setPersonaFromChat } from '../../ais/persona';
import { addFact } from '../memory/facts';
import { recallMemory, zoomMemory } from '../memory/recall';
import type { ExecuteToolCall, ToolExecution, ValidToolCall } from '../tool-loop';
import {
  ASK_PEOPLE_TOOL,
  DELEGATE_TOOL,
  FETCH_MEDIA_TOOL,
  MEMORY_ZOOM_TOOL,
  PERSONA_SUMMARY_MAX_LENGTH,
  POST_BLOCKS_TOOL,
  RECALL_TOOL,
  REMEMBERED_FACT_MAX_LENGTH,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  SAVE_TEXT_MEDIA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
} from '../tools/schemas';
import { TOOL_GUIDE } from '../tool-guide';
import { looksLikeSecret } from '../memory/secrets';
import {
  createTurnDeskRunner,
  isDeskToolCall,
  runDeskCall,
  type DeskTurnContext,
} from './desk-exec';
import { createAskPeopleRunner } from './ask-people';
import { createPostBlocksRunner } from './post-blocks';
import { runFetchMedia } from './fetch-media';
import { runSaveTextMedia } from './save-text-media';
import { recordCard } from '../../message-blocks/cards';
import { getCardMedia } from '../../card-media/service';
import { createDelegateRunner } from './delegate-run';
import {
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomRound,
  denialReasonForModel,
  formatModelText,
} from './contracts';
import type { createLiveSession } from './live';
import type { RequestActionContext } from './group-turn';
import type { ActionGateway, RequestOutcome } from '../../actions/gateway';
import { errorName } from '../../effect/error-utils';

type RequestActionCall = Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>;
type RequestActionChat = { groupId: string; topicId: string };

// Routes a `request_action` call into the action gateway. The ai id and chat
// ids always come from the session, never from the call: a model that smuggles
// `aiId` or `groupId` inside `args` cannot change who is asked. No adapter text
// beyond the success `summary` reaches the AI. The group context adjusts the
// pending wording ("in this chat" vs "in this room") and tags the group and
// topic ids.
export function createRequestActionRunner(
  actions: ActionGateway | undefined,
  logger: GatewayLogger,
) {
  const runRequestActionEffect = Effect.fnUntraced(function* (
    session: AiSession,
    call: RequestActionCall,
    chat?: RequestActionChat,
    unattended?: boolean,
    signal?: AbortSignal,
  ): Effect.fn.Return<ToolExecution> {
    if (actions === undefined) {
      return { content: 'invalid: unknown tool: request_action' };
    }
    const outcome = yield* Effect.promise(() =>
      actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
        // A scheduled (unattended) run runs tier 0/1 and refuses a tier-2
        // request without a standing rule instead of parking a card.
        ...(unattended === true ? { unattended: true } : {}),
        // The turn's abort signal cancels an adapter call that is still running.
        ...(signal === undefined ? {} : { signal }),
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
        return {
          content: `done: ${outcome.summary}${formatModelText(outcome.modelText)}`,
          // The adapter posted the answer into the room itself (a `blocks`
          // card), so the group turn sends no echo reply.
          ...(outcome.posted === true ? { postedToRoom: true } : {}),
        };
      case 'pending_approval':
        // The card is the owner's view; the model gets a short fixed line. In
        // groups only admins, owners and the AI's owner get the buttons. The
        // approval id rides along so the session log can record it.
        return {
          content:
            chat === undefined
              ? "waiting for your owner's approval; a card was posted in this chat"
              : "waiting for an admin's approval; a card was posted in this room",
          approvalId: outcome.approvalId,
        };
      case 'failed':
        return { content: 'the action failed' };
      case 'denied':
        return { content: `denied: ${denialReasonForModel(outcome.reason)}` };
    }
  });

  const runRequestAction = (
    session: AiSession,
    call: RequestActionCall,
    chat?: RequestActionChat,
    unattended?: boolean,
    signal?: AbortSignal,
  ): Promise<ToolExecution> =>
    Effect.runPromise(runRequestActionEffect(session, call, chat, unattended, signal));

  return { runRequestAction, runRequestActionEffect };
}
// One line appended after a successful `update_persona`, so the owner sees what
// happened without relying on the model to say it.
function formatPersonaUpdatedLine(summary: string): string {
  const clean = sanitizeSummary(summary);
  return `\n\n✏️ Persona updated: ${clean === '' ? 'updated' : clean}. Say "undo" to revert.`;
}

const PERSONA_RESTORED_LINE = '\n\n↩️ Persona restored.';

// One plain line appended after a successful `remember`, so everyone sees which
// fact was pinned. No emoji.
function formatRememberedLine(text: string): string {
  return `\n\nRemembered: ${sanitizeLine(text, REMEMBERED_FACT_MAX_LENGTH)}`;
}

// The summary rides into the DM text, so it stays one short line: newlines
// and control characters become spaces, runs collapse, and it caps at 200.
function sanitizeSummary(summary: string): string {
  return sanitizeLine(summary, PERSONA_SUMMARY_MAX_LENGTH);
}

// Shared by both lines: control characters become spaces, whitespace runs
// collapse, and the result caps at `maxLength`.
function sanitizeLine(text: string, maxLength: number): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
type LiveSession = ReturnType<typeof createLiveSession>;

interface ToolExecContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  sessionIsLive: LiveSession['sessionIsLive'];
  pumpRoom: (session: AiSession, roomJid: string) => Promise<void>;
  secretsFor: (secret?: string) => string[];
  liveSendMessage: LiveSession['liveSendMessage'];
}

export function createToolExec(ctx: ToolExecContext) {
  const {
    deps,
    logger,
    sessions,
    roomRounds,
    sessionIsLive,
    pumpRoom,
    secretsFor,
    liveSendMessage,
  } = ctx;
  const { runRequestAction, runRequestActionEffect } = createRequestActionRunner(
    deps.actions,
    logger,
  );
  const { runAskPeopleEffect } = createAskPeopleRunner(deps.db, logger, liveSendMessage);
  const { runPostBlocksEffect } = createPostBlocksRunner(
    logger,
    liveSendMessage,
    (input) => recordCard(deps.db, input).then(() => undefined),
    (id) => getCardMedia(deps.db, id),
  );
  const { runDelegate, runTaskStatus } = createDelegateRunner({
    deps,
    logger,
    sessions,
    roomRounds,
    pumpRoom,
    secretsFor,
  });

  // Runs one validated tool call against the gateway's own AI id. The id and
  // `chatKey` come from the session/turn, never from the model's arguments.
  // Log lines carry ids, the tool name and the outcome only: never text.
  function executeToolCall(
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
    desk?: DeskTurnContext,
    options?: { unattended?: boolean; dmJid?: string; signal?: AbortSignal },
  ): ExecuteToolCall {
    const aiId = session.aiId;
    // One desk runner per turn, created only when the turn offered the desk
    // tools; `null` keeps an improvised call an unknown tool.
    const deskRunner = createTurnDeskRunner(desk, aiId, logger);
    // At most five facts saved per turn. The counter lives in this closure,
    // created once per turn, so it resets with the turn.
    let savedFacts = 0;
    // At most four media calls per turn, so one model cannot pull unbounded
    // data through the server; `fetch_media` and `save_text_media` share it.
    // It resets with the turn.
    let mediaThisTurn = 0;
    const execute = Effect.fnUntraced(function* (
      call: ValidToolCall,
    ): Effect.fn.Return<ToolExecution> {
      // A turn that was computing when the AI was stopped must not change the
      // persona afterwards, and a tier-2 action must not run without the
      // owner's approval.
      if (!sessionIsLive(session)) {
        return { content: 'the AI was stopped' };
      }
      if (isDeskToolCall(call)) return yield* Effect.promise(() => runDeskCall(deskRunner, call));
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
        // `delegate` is offered only when this AI may delegate and at least
        // one accepting AI is in the room; an improvised call otherwise gets
        // `invalid: unknown tool`. `task_status` stays known: it reads an
        // existing row scoped to the two involved AIs.
        const isDelegationTool = call.tool === DELEGATE_TOOL || call.tool === TASK_STATUS_TOOL;
        if (
          !isMemoryTool &&
          !isDelegationTool &&
          call.tool !== REQUEST_ACTION_TOOL &&
          call.tool !== ASK_PEOPLE_TOOL &&
          call.tool !== POST_BLOCKS_TOOL &&
          call.tool !== FETCH_MEDIA_TOOL &&
          call.tool !== SAVE_TEXT_MEDIA_TOOL
        ) {
          return { content: 'invalid: unknown tool' };
        }
        if (call.tool === DELEGATE_TOOL && context.delegateTargetIds.size === 0) {
          return { content: 'invalid: unknown tool' };
        }
        if (call.tool === REQUEST_ACTION_TOOL && !context.allowActions) {
          return { content: 'invalid: unknown tool' };
        }
        // `ask_people` is offered only when a person triggered the turn; an AI
        // handoff or a delegated trigger that improvises it gets unknown-tool.
        if (call.tool === ASK_PEOPLE_TOOL && !context.askPeople) {
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
        return yield* runDelegate(session, context, call);
      }
      if (call.tool === TASK_STATUS_TOOL) {
        return yield* runTaskStatus(session, context, call);
      }
      if (call.tool === ASK_PEOPLE_TOOL) {
        // Only reachable in a group turn that offered the tool; a DM (which
        // has no context) or a turn where the flag was off got the guard above.
        if (context === undefined) {
          return { content: 'invalid: unknown tool' };
        }
        return yield* runAskPeopleEffect(session, call, {
          groupId: context.groupId,
          topicId: context.topicId,
          roomJid: context.roomJid,
        });
      }
      if (call.tool === POST_BLOCKS_TOOL) {
        // Offered on every group turn and in the owner's DM; any other
        // context-free turn (an AI handoff, say) stays an unknown tool.
        if (context === undefined) {
          if (options?.dmJid === undefined) {
            return { content: 'invalid: unknown tool' };
          }
          return yield* runPostBlocksEffect(session, call, {
            roomJid: options.dmJid,
            kind: 'chat',
          });
        }
        return yield* runPostBlocksEffect(session, call, {
          roomJid: context.roomJid,
          groupId: context.groupId,
          topicId: context.topicId,
        });
      }
      if (call.tool === FETCH_MEDIA_TOOL || call.tool === SAVE_TEXT_MEDIA_TOOL) {
        // Both are offered wherever `post_blocks` is: a group turn names the
        // room, the owner's DM names the AI's own JID (never the owner's), and
        // any other context-free turn stays an unknown tool.
        if (context === undefined && options?.dmJid === undefined) {
          return { content: 'invalid: unknown tool' };
        }
        if (mediaThisTurn >= 4) {
          const label = call.tool === FETCH_MEDIA_TOOL ? 'AI fetch_media' : 'AI save_text_media';
          logger.info({ aiId, tool: call.tool, ok: false }, label);
          return { content: 'error: at most 4 media per turn' };
        }
        mediaThisTurn += 1;
        const chat =
          context === undefined
            ? { roomJid: session.aiJid }
            : {
                roomJid: context.roomJid,
                groupId: context.groupId,
                topicId: context.topicId,
              };
        return yield* Effect.promise(() =>
          call.tool === FETCH_MEDIA_TOOL
            ? runFetchMedia(deps, session, call, chat)
            : runSaveTextMedia(deps, session, call, chat),
        );
      }
      if (call.tool === UPDATE_PERSONA_TOOL) {
        yield* Effect.promise(() => setPersonaFromChat(deps.db, aiId, call.persona));
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona updated by chat');
        return { content: 'ok', notice: formatPersonaUpdatedLine(call.summary) };
      }
      if (call.tool === REQUEST_ACTION_TOOL) {
        const unattended = options?.unattended === true;
        // The sender's membership may have changed during a long turn: re-check
        // the database before calling the action gateway and short-circuit to
        // `denied: not allowed` when they left. The gateway is never invoked,
        // so no audit row is written and no card appears. A scheduled run has
        // no live person and skips the re-check.
        if (context !== undefined && !unattended) {
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
          unattended,
          options?.signal,
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

  // Appends the fixed tool guide to the last user turn. The system prompt
  // builders take no options (their shape is frozen for provider caching), so
  // the guide rides as a separate user turn right before the trigger.
  function withToolGuide(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return [...messages, { role: 'user', content: TOOL_GUIDE }];
  }

  return { executeToolCall, runRequestAction, withToolGuide };
}
