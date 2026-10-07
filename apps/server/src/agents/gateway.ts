import {
  createXmppCore,
  type ChatKind,
  type ChatMessage,
  type SendMessageOptions,
  type XmppCore,
} from '@zilar/xmpp-core';
import type { Payload } from '@zilar/protocol';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DEFAULT_LITELLM_BASE_URL, type LitellmAdminClient } from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import {
  ensureAiModel,
  listActiveAisForGateway,
  onAiLifecycle,
  revertPersonaFromChat,
  setPersonaFromChat,
  type ActiveAiForGateway,
  type AiServiceDeps,
} from '../ais/service';
import type { KeyCipher } from '../connections/crypto';
import { ais, groups, llmVirtualKeys, topics } from '../db/schema';
import { sharedDraftHub } from '../drafts/hub';
import { onGroupAi, onTopicAi } from '../groups/events';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { issueXmppToken } from '../xmpp/token';
import {
  bareJid,
  buildDmMessages,
  buildGroupMessages,
  displayNameOf,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
} from './context';
import { TOOL_GUIDE } from './tool-guide';
import { looksLikeSecret } from './memory/secrets';
import { addFact, recallMemory, zoomMemory } from './memory/store';
import {
  mapFailureToReply,
  runDmTurn,
  runGroupTurn,
  type ExecuteToolCall,
  type ToolExecution,
  type ValidToolCall,
} from './reply';
import {
  buildGroupTools,
  buildTools,
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
} from './tools';
import { createDelegation, finishDelegation, getDelegationForAi } from './delegation/service';
import type { RequestOutcome } from '../actions/gateway';
import {
  GATEWAY_RESOURCE,
  GROUP_JOIN_SKEW_MS,
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  RECONCILE_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  ROUND_MAX_AI_TURNS,
  ROUND_MAX_HOPS,
  XMPP_TOKEN_TTL_SECONDS,
  denialReasonForModel,
  errorName,
  formatModelText,
  isAiSender,
  retryDelayMs,
  toRedactedError,
  type AgentGateway,
  type AgentGatewayConfig,
  type AgentGatewayDeps,
  type AiSession,
  type PendingMessage,
  type RoomPendingMessage,
  type RoomRound,
} from './gateway/contracts';
import { createBudgetGate } from './gateway/budget';
import { listAiRooms, loadActiveAi, loadOwnerName, loadRoomGateState } from './gateway/db';
import { createRoomListener } from './gateway/listener';
import { createMemoryRunner } from './gateway/memory';

export type {
  AgentGateway,
  AgentGatewayConfig,
  AgentGatewayDeps,
  GatewayLogger,
} from './gateway/contracts';
export {
  GATEWAY_RESOURCE,
  GROUP_JOIN_SKEW_MS,
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  LISTENER_EVERY_N_DEFAULT,
  LISTENER_QUIET_MS_DEFAULT,
  RECONCILE_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  ROUND_MAX_AI_TURNS,
  ROUND_MAX_HOPS,
} from './gateway/contracts';

// Agent gateway v0: keeps every active AI online over XMPP and replies to the
// AI's owner in their DM. The AI id always comes from the gateway's own
// connection map, never from message content. Reconnects are xmpp-core's own
// auto-reconnect plus this module's backoff on failed connects and the
// periodic reconcile as a safety net.
export function createAgentGateway(
  deps: AgentGatewayDeps,
  config: AgentGatewayConfig,
): AgentGateway {
  const logger = deps.logger;
  const turnLogger = deps.turnLogger ?? deps.logger;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const retryBaseMs = config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  const createCore = deps.createCore ?? createXmppCore;
  const baseUrl = deps.litellmBaseUrl ?? DEFAULT_LITELLM_BASE_URL;
  const draftHub = deps.drafts?.hub ?? sharedDraftHub;
  const sessions = new Map<string, AiSession>();
  // AIs another gateway replaced while this process runs. `reconcile` and
  // retries never reconnect them again until the gateway restarts. In memory
  // only, keyed by the gateway's own AI ids.
  const superseded = new Set<string>();
  // T-0479: per-room round budgets (see RoomRound). In memory: a restart
  // safely resets it, a fresh start can only wake fewer AIs.
  const roomRounds = new Map<string, RoomRound>();
  // T-0475: the listener's per-room debounce windows and scoring calls.
  const roomListener = createRoomListener({
    deps,
    logger,
    baseUrl,
    secretsFor,
    sessions,
    roomRounds,
    sessionIsLive,
    pumpRoom: (session, roomJid) => pumpRoom(session, roomJid),
  });

  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribes: Array<() => void> = [];

  function nowMs(): number {
    return (deps.now ?? (() => new Date()))().getTime();
  }

  function roomJidFor(roomLocalpart: string): string {
    return normBareJid(`${roomLocalpart}@${deps.xmpp.mucDomain}`);
  }

  function aiDeps(): AiServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      // Checked in `start`: both are present whenever a session runs.
      litellm: deps.litellm as LitellmAdminClient,
      cipher: deps.cipher as KeyCipher,
      logger,
      domain: deps.xmpp.domain,
    };
  }

  function secretsFor(virtualKey?: string): string[] {
    return [
      ...(virtualKey === undefined ? [] : [virtualKey]),
      ...(deps.masterKeyForRedaction === undefined ? [] : [deps.masterKeyForRedaction]),
    ];
  }

  // The budget gate owns the in-memory notice state, the daily-limit check,
  // the 80% warnings and the per-round gate, shared by the DM and group turns.
  const budgetGate = createBudgetGate({ deps, logger, sessionIsLive, secretsFor });

  const { loadMemoryContext, startCompaction } = createMemoryRunner({
    deps,
    logger,
    baseUrl,
    modelNameForAi,
    secretsFor,
    nowMs,
    toRedactedError,
    checkDmRoundGate: budgetGate.checkDmRoundGate,
  });

  // Per-turn context for a `request_action` call in a group (T-0098). The
  // `groupId` and `topicId` are the room the AI was woken in — they ride
  // along to the action gateway and are used to pick the model-facing
  // wording. The `isStillAllowed` callback re-queries the database right
  // before the action gateway runs, so a role change that landed between
  // the turn starting and the tool executing short-circuits to
  // `denied: not allowed` without calling the gateway. `allowActions` is
  // false when the trigger may not ask for one, so an improvised
  // `request_action` gets `invalid: unknown tool`.
  interface RequestActionContext {
    groupId: string;
    topicId: string;
    /** T-0482: the room JID the turn is answering in, so `delegate` can queue
     * the worker's synthetic trigger and read this AI's room nick. */
    roomJid: string;
    /** T-0482: the message id that opened the turn, stored as `reply_to`. */
    triggerId: string;
    isStillAllowed: () => Promise<boolean>;
    allowActions: boolean;
    /** T-0482: the AI ids in this room that may receive a delegation. Empty
     * when this AI may not delegate or no accepting AI is present, which makes
     * both delegation tools answer `invalid: unknown tool`. */
    delegateTargetIds: ReadonlySet<string>;
  }

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
    return async (call) => {
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
        const lines = await recallMemory(deps.db, aiId, chatKey, call.query);
        logger.info({ aiId, tool: call.tool, ok: true }, 'AI memory tool');
        return { content: lines.length === 0 ? 'no matches' : lines.join('\n') };
      }
      if (call.tool === MEMORY_ZOOM_TOOL) {
        const lines = await zoomMemory(deps.db, aiId, chatKey, call.block);
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
        const outcome = await addFact(deps.db, aiId, chatKey, call.text);
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
        let created: Awaited<ReturnType<typeof createDelegation>>;
        try {
          created = await createDelegation(deps.db, {
            fromAiId: session.aiId,
            toAiId: call.toAiId,
            groupId: context.groupId,
            ...(context.topicId === '' ? {} : { topicId: context.topicId }),
            objective: call.objective,
            ...(call.contextSummary === undefined ? {} : { contextSummary: call.contextSummary }),
            ...(call.acceptance === undefined ? {} : { acceptance: call.acceptance }),
            ...(call.returnFormat === undefined ? {} : { returnFormat: call.returnFormat }),
            replyTo: context.triggerId,
          });
        } catch (error) {
          logger.warn(
            { err: errorName(error), fromAiId: session.aiId, toAiId: call.toAiId },
            'AI delegation create threw',
          );
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
        void pumpRoom(worker, context.roomJid).catch((error: unknown) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: worker.aiId },
            'AI group pump failed',
          );
        });
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
        const view = await getDelegationForAi(deps.db, call.taskId, aiId);
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
        await setPersonaFromChat(deps.db, aiId, call.persona);
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
          const stillAllowed = await context.isStillAllowed();
          if (!stillAllowed) {
            logger.info(
              { aiId: session.aiId, action: call.action, groupId: context.groupId },
              'AI request_action denied: sender no longer allowed',
            );
            return { content: 'denied: not allowed' };
          }
        }
        return runRequestAction(
          session,
          call,
          context === undefined
            ? undefined
            : { groupId: context.groupId, topicId: context.topicId },
        );
      }
      const outcome = await revertPersonaFromChat(deps.db, aiId);
      logger.info({ aiId, tool: call.tool, ok: true }, 'AI persona revert by chat');
      if (outcome === 'nothing to undo') {
        return { content: 'nothing to undo' };
      }
      return { content: 'ok', notice: PERSONA_RESTORED_LINE };
    };
  }

  // Routes a `request_action` call into the action gateway. The ai id and
  // chat ids always come from the session, never from the call: a model
  // that smuggles `aiId` or `groupId` inside `args` cannot change who is
  // asked. The mapping below is the exact model-facing wording per
  // outcome (see spec); no adapter text beyond the success `summary`
  // reaches the AI. The group context (when present) adjusts the
  // pending-approval wording — owners see "in this chat", admins see "in
  // this room" — and tags the request with the room's group and topic ids.
  async function runRequestAction(
    session: AiSession,
    call: Extract<ValidToolCall, { tool: typeof REQUEST_ACTION_TOOL }>,
    chat?: { groupId: string; topicId: string },
  ): Promise<ToolExecution> {
    const actions = deps.actions;
    if (actions === undefined) {
      // No action gateway wired: the tool was never offered, so this call
      // is treated as an unknown tool and answered honestly.
      return { content: 'invalid: unknown tool: request_action' };
    }
    let outcome: RequestOutcome;
    try {
      outcome = await actions.request({
        aiId: session.aiId,
        ...(chat === undefined ? {} : { groupId: chat.groupId, topicId: chat.topicId }),
        action: call.action,
        args: call.args,
        requestedBy: session.aiJid,
      });
    } catch (error) {
      // The gateway is best-effort: a thrown error here would mean a bug
      // we cannot leak. Log the class name only and answer as failed.
      logger.warn(
        { err: errorName(error), aiId: session.aiId, action: call.action },
        'action gateway request threw',
      );
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
  }

  function scheduleRetry(session: AiSession): void {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    session.retryAttempt += 1;
    const delay = retryDelayMs(session.retryAttempt, retryBaseMs);
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
    }
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined;
      if (session.stopped || sessions.get(session.aiId) !== session) {
        return;
      }
      void session.core
        .connect()
        .then(() => {
          session.retryAttempt = 0;
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI reconnect failed; retrying',
          );
          scheduleRetry(session);
        });
    }, delay);
  }

  // Whether a session is still owned by the gateway. T-0080: every send path
  // a running AI turn triggers — DM reply, group reply, budget warnings,
  // daily-limit notice, drafts, persona-tool notice — checks this right
  // before it sends, so a stop that lands mid-turn drops the reply rather
  // than delivering it. `disconnectAi` flips `stopped` to `true` and removes
  // the session from the map; both checks together cover the race.
  function sessionIsLive(session: AiSession): boolean {
    return !session.stopped && sessions.get(session.aiId) === session;
  }

  // Wraps `core.sendMessage` so any send during a turn is skipped the moment
  // the AI is stopped. The skip resolves with an empty id, which matches
  // what `sendMessage` returns for a successful send — the caller still
  // sees a successful path, only the wire never carries the text.
  function liveSendMessage(
    session: AiSession,
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<{ id: string }> {
    if (!sessionIsLive(session)) {
      return Promise.resolve({ id: '' });
    }
    return session.core.sendMessage(to, kind, text, opts);
  }

  // T-0106: appends the fixed tool guide to the last user turn. The system
  // prompt builders take no options (their shape is frozen for provider
  // caching), so the guide rides as a separate user turn right before the
  // trigger. Only called when tools are enabled and adapters are
  // registered; otherwise the messages pass through untouched.
  function withToolGuide(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return [...messages, { role: 'user', content: TOOL_GUIDE }];
  }

  // T-0106: posts one live progress message for a multi-round turn and
  // updates it at each round (XMPP message correction, the same mechanism
  // streaming replies use). Stage texts come from the fixed table in
  // `agents/tool-guide.ts` — never model text, never tool output. Best
  // effort: a failed post or update warns with ids only and the turn
  // continues. Resolves with the progress message id when one was posted,
  // else null.
  function liveProgressReporter(
    session: AiSession,
    to: string,
    kind: ChatKind,
    aiJid: string,
  ): {
    reportProgress: (stage: string) => Promise<string | null>;
    clearProgress: () => Promise<void>;
  } {
    let progressId: string | null = null;
    return {
      reportProgress: async (stage: string): Promise<string | null> => {
        if (!sessionIsLive(session)) {
          return null;
        }
        const payload = { v: 0 as const, type: 'progress' as const, data: { ai: aiJid, stage } };
        try {
          if (progressId === null) {
            const sent = await session.core.sendMessage(to, kind, stage, { payload });
            progressId = sent.id === '' ? null : sent.id;
            return progressId;
          }
          await session.core.sendCorrection(to, kind, progressId, stage);
          return progressId;
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI progress message could not be sent',
          );
          return progressId;
        }
      },
      clearProgress: async (): Promise<void> => {
        // The final text replaces the progress line: clients render the
        // newest message, and the progress card drops out of view. A
        // correction keeps one bubble instead of leaving a stale
        // "working on it" line next to the answer. Best effort like
        // every other progress send.
        if (progressId === null || !sessionIsLive(session)) {
          return;
        }
        try {
          await session.core.sendRetraction(to, kind, progressId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI progress message could not be cleared',
          );
        }
        progressId = null;
      },
    };
  }

  function liveSendTyping(
    session: AiSession,
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.sendTyping(to, kind, state);
  }

  function liveMarkDisplayed(
    session: AiSession,
    chatJid: string,
    kind: ChatKind,
    messageId: string,
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.markDisplayed(chatJid, kind, messageId);
  }

  async function connectAi(record: ActiveAiForGateway): Promise<void> {
    if (!started || sessions.has(record.id) || superseded.has(record.id)) {
      return;
    }
    const aiId = record.id;
    const aiJid = record.jid;
    let core: XmppCore;
    try {
      core = createCore({
        service: deps.xmpp.wsPublicUrl,
        domain: deps.xmpp.domain,
        resource: GATEWAY_RESOURCE,
        getToken: async () => {
          const issued = await issueXmppToken(deps.xmpp, aiJid, XMPP_TOKEN_TTL_SECONDS);
          return { jid: aiJid, token: issued.token };
        },
      });
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI client could not be created',
      );
      return;
    }

    const session: AiSession = {
      aiId,
      aiJid,
      core,
      busy: false,
      pending: [],
      stopped: false,
      retryAttempt: 0,
      retryTimer: undefined,
      unsubs: [],
      rooms: new Map(),
      roomPending: new Map(),
      roomBusy: new Set(),
      roomTurns: new Map(),
    };
    sessions.set(aiId, session);
    session.unsubs.push(
      core.on('message', (message) => {
        handleIncoming(session, message);
      }),
      core.on('replaced', () => {
        handleReplaced(session);
      }),
      core.on('status', (status) => {
        // Tokens never appear here: only the AI id is logged.
        if (status === 'online') {
          logger.info({ aiId }, 'AI is online');
        } else if (status === 'offline') {
          logger.warn({ aiId }, 'AI is offline');
        }
      }),
    );

    try {
      await core.connect();
      session.retryAttempt = 0;
    } catch (error) {
      // One AI failing to connect must never stop the others; the retry
      // timer and the reconcile loop pick it up later.
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId },
        'AI failed to connect; retrying',
      );
      scheduleRetry(session);
      return;
    }
    // The gateway may have stopped while the login was in flight: never keep
    // a connection nobody owns any more.
    if (!started || session.stopped || sessions.get(aiId) !== session) {
      await disconnectAi(aiId).catch(() => undefined);
      return;
    }
    // Rooms never break DMs: a room sync failure is logged inside and the
    // session stays up for DMs either way.
    await syncAiRooms(session, record.name);
  }

  async function disconnectAi(aiId: string): Promise<void> {
    const session = sessions.get(aiId);
    if (session === undefined) {
      return;
    }
    sessions.delete(aiId);
    for (const roomJid of session.rooms.keys()) {
      roomListener.dropRoomListenerIfUnused(roomJid);
    }
    session.stopped = true;
    if (session.retryTimer !== undefined) {
      clearTimeout(session.retryTimer);
      session.retryTimer = undefined;
    }
    for (const unsub of session.unsubs) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    session.unsubs = [];
    try {
      await session.core.disconnect();
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()), aiId }, 'AI disconnect failed');
    }
    logger.info({ aiId }, 'AI is offline');
  }

  // Drifts the AI's room joins toward the database: joins every room the AI
  // belongs to with the AI's name as nick, re-joins when the nick went stale,
  // and leaves rooms the AI no longer belongs to. A join failure is logged
  // (ids only) and retried by the next reconcile; it never throws and never
  // breaks the AI's DMs.
  async function syncAiRooms(session: AiSession, aiName: string): Promise<void> {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    let rooms: Array<{ groupId: string; topicId: string; roomLocalpart: string }>;
    try {
      rooms = await listAiRooms(deps.db, session.aiId);
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI rooms lookup failed',
      );
      return;
    }
    const wanted = new Set<string>();
    for (const room of rooms) {
      const roomJid = roomJidFor(room.roomLocalpart);
      wanted.add(roomJid);
      const known = session.rooms.get(roomJid);
      if (known !== undefined && known.nick === aiName) {
        continue;
      }
      if (known !== undefined) {
        await leaveRoomQuietly(session, roomJid, known.groupId);
      }
      try {
        await session.core.joinRoom(roomJid, aiName);
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: session.aiId, groupId: room.groupId },
          'AI room join failed; reconcile will retry',
        );
        continue;
      }
      session.rooms.set(roomJid, {
        groupId: room.groupId,
        topicId: room.topicId,
        joinedAtMs: nowMs(),
        nick: aiName,
      });
      logger.info({ aiId: session.aiId, groupId: room.groupId }, 'AI joined the room');
    }
    for (const [roomJid, sub] of session.rooms) {
      if (!wanted.has(roomJid)) {
        await leaveRoomQuietly(session, roomJid, sub.groupId);
      }
    }
  }

  async function leaveRoomQuietly(
    session: AiSession,
    roomJid: string,
    groupId: string,
  ): Promise<void> {
    session.rooms.delete(roomJid);
    session.roomPending.delete(roomJid);
    session.roomBusy.delete(roomJid);
    // A re-added AI starts with a fresh rate budget.
    session.roomTurns.delete(roomJid);
    roomListener.dropRoomListenerIfUnused(roomJid);
    try {
      await session.core.leaveRoom(roomJid);
    } catch (error) {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId, groupId },
        'AI room leave failed',
      );
      return;
    }
    logger.info({ aiId: session.aiId, groupId }, 'AI left the room');
  }

  // Looks up the AI's owner id from the database. The owner JID is derived
  // the same way the rest of the platform derives it (via `localpartFor` and
  // `jidFor`), so a DM announcement lands where the gateway already talks.
  async function loadOwnerId(aiId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ owner: ais.owner })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    return row?.owner ?? null;
  }

  // Looks up the room JID (bare) for one group. Returns `null` when the
  // group does not exist; the caller answers `false` for that case too.
  async function loadRoomJid(groupId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ roomLocalpart: groups.roomLocalpart })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  }

  // Looks up the room JID (bare) for one topic. Returns `null` when the
  // topic does not exist or is archived; the caller answers `false` for
  // those cases too.
  async function loadTopicRoomJid(topicId: string): Promise<string | null> {
    const [row] = await deps.db
      .select({ roomLocalpart: topics.roomLocalpart, archivedAt: topics.archivedAt })
      .from(topics)
      .where(eq(topics.id, topicId))
      .limit(1);
    if (row === undefined || row.archivedAt !== null) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  }

  // Builds the `SendMessageOptions` for one `postToChat` call. The
  // `payload` field is only present when the caller actually passed one.
  function sendOptions(input: { text: string; payload?: Payload }): SendMessageOptions {
    return input.payload === undefined ? {} : { payload: input.payload };
  }

  // T-0092: posts one message from the AI's live XMPP session into the chat
  // the action gateway asked about. The session must be live (not stopped,
  // still owned by this gateway), the AI must exist, and — for a group —
  // the session must currently hold a subscription to the room. Any other
  // answer is `false` with no send, so a stopped AI (kill switch) and an
  // AI that was never in the room stay silent. T-0109: an optional `topicId`
  // posts into that topic's room instead (the AI must be a member and the
  // topic live); otherwise the group post goes into General (the group's own
  // room) or the DM. `session.rooms.has(roomJid)` remains the guard.
  async function postToChat(input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }): Promise<boolean> {
    const session = sessions.get(input.aiId);
    if (session === undefined || !sessionIsLive(session)) {
      return false;
    }
    if (input.groupId === null) {
      const ownerId = await loadOwnerId(input.aiId);
      if (ownerId === null) {
        return false;
      }
      const ownerJid = jidFor(localpartFor(ownerId), deps.xmpp.domain);
      await liveSendMessage(session, ownerJid, 'chat', input.text, sendOptions(input));
      return true;
    }
    if (input.topicId !== undefined) {
      const topicJid = await loadTopicRoomJid(input.topicId);
      if (topicJid === null) {
        return false;
      }
      if (!session.rooms.has(topicJid)) {
        return false;
      }
      await liveSendMessage(session, topicJid, 'groupchat', input.text, sendOptions(input));
      return true;
    }
    const roomJid = await loadRoomJid(input.groupId);
    if (roomJid === null) {
      return false;
    }
    if (!session.rooms.has(roomJid)) {
      return false;
    }
    await liveSendMessage(session, roomJid, 'groupchat', input.text, sendOptions(input));
    return true;
  }

  // Another gateway logged this AI in with the same resource and ejabberd
  // replaced this session: the newest gateway wins, so this process stands
  // down for the AI and never reconnects it until a restart. Pending
  // messages are dropped and no new turns start; a turn already in flight
  // may finish, but its final send fails quietly once torn down.
  function handleReplaced(session: AiSession): void {
    if (sessions.get(session.aiId) !== session) {
      return;
    }
    superseded.add(session.aiId);
    // The AI id only: never tokens, JIDs with tokens, or message bodies.
    logger.warn({ aiId: session.aiId }, 'AI session replaced by another gateway; standing down');
    session.pending.length = 0;
    session.roomPending.clear();
    void disconnectAi(session.aiId).catch(() => undefined);
  }

  async function reconcile(): Promise<void> {
    let active: ActiveAiForGateway[];
    try {
      active = await listActiveAisForGateway(deps.db);
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()) }, 'AI reconcile failed');
      return;
    }
    const wanted = new Set(active.map((ai) => ai.id));
    for (const ai of active) {
      try {
        const existing = sessions.get(ai.id);
        if (existing === undefined) {
          await connectAi(ai);
        } else {
          // Rooms drift without a reconnect: a missed group event, a failed
          // join, or a stale nick is picked up here at the latest.
          await syncAiRooms(existing, ai.name);
        }
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: ai.id },
          'AI reconcile connect failed',
        );
      }
    }
    for (const aiId of sessions.keys()) {
      if (!wanted.has(aiId)) {
        try {
          await disconnectAi(aiId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI reconcile disconnect failed',
          );
        }
      }
    }
  }

  function handleIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction of a message is never a new turn, in a DM or in a
    // room: the AI re-answering edits is out of scope. This is the first check,
    // before any routing, pairing, database or model work.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    if (message.kind === 'groupchat') {
      handleRoomIncoming(session, message);
      return;
    }
    // v0 answers DMs only. Groups, own messages and empty bodies are ignored
    // before any database or model work.
    if (message.kind !== 'chat' || message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    session.pending.push({ id: message.id, body, fromJid: message.fromJid });
    // `busy` is reset in the pump's `finally`, but a truly unexpected throw
    // still needs a redacted log line rather than an unhandled rejection.
    void pumpSession(session).catch((error: unknown) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI pump failed',
      );
    });
  }

  // T-0481: the live session for an `ai-*` sender's bare JID, if this gateway
  // runs it. `sessions` is keyed by the gateway's own AI id, so match the JID.
  function sessionForAiJid(bare: string): AiSession | undefined {
    for (const candidate of sessions.values()) {
      if (normBareJid(candidate.aiJid) === bare) {
        return candidate;
      }
    }
    return undefined;
  }

  // M2 rule 1 (§9.4): a person @mentions AIs, and only those AIs reply. Every
  // check that needs no database runs here; the sender's membership and the
  // rate limit are checked fresh at turn time.
  function handleRoomIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction in a room is never a mention: it starts no turn.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    if (message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    const roomJid = normBareJid(message.chatJid);
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      // Not a room this AI joined: strangers' rooms are never answered.
      return;
    }
    // History replayed on join carries its original stamp, far older than the
    // join. Live messages carry ~now.
    if (message.timestamp.getTime() < room.joinedAtMs - GROUP_JOIN_SKEW_MS) {
      return;
    }
    // T-0479: every human room message opens a fresh round, mention or not.
    // Every AI session receives the same stanza, so an id we already opened on
    // leaves the running count alone.
    if (!isAiSender(normBareJid(message.fromJid))) {
      const round = roomRounds.get(roomJid);
      if (round === undefined || round.humanMessageId !== message.id) {
        roomRounds.set(roomJid, {
          humanMessageId: message.id,
          aiTurns: 0,
          hops: 0,
          handoffIds: new Set(),
        });
      }
    }
    const aiBare = normBareJid(session.aiJid);
    const mentioned = (message.mentions ?? []).some(
      (mention) => normBareJid(mention.jid) === aiBare,
    );
    // T-0475: the listener sees every human room message, mention or not,
    // before the mention early-return below. AI senders never feed it.
    if (deps.listener !== undefined && !isAiSender(normBareJid(message.fromJid))) {
      roomListener.noteListenerMessage(roomJid, room, message, body);
    }
    if (!mentioned) {
      // No mention, nobody replies (M2 rule 3).
      return;
    }
    const fromBare = normBareJid(message.fromJid);
    let handoff = false;
    if (isAiSender(fromBare)) {
      // T-0481: an AI mentioning another AI hands the question over, inside
      // the round's hop budget. The sender must be another live session
      // joined to this room — never a JID or nick taken from the message.
      const senderSession = sessionForAiJid(fromBare);
      if (senderSession === undefined || !senderSession.rooms.has(roomJid)) {
        return;
      }
      const round = roomRounds.get(roomJid);
      if (round === undefined) {
        return;
      }
      if (!round.handoffIds.has(message.id)) {
        if (round.hops >= ROUND_MAX_HOPS) {
          logger.info(
            { roomJid, fromAiId: senderSession.aiId, toAiId: session.aiId },
            'AI handoff budget spent',
          );
          return;
        }
        round.handoffIds.add(message.id);
        round.hops += 1;
      }
      handoff = true;
    }
    const queued = session.roomPending.get(roomJid) ?? [];
    queued.push({
      id: message.id,
      body,
      fromJid: message.fromJid,
      fromResolved: message.fromResolved,
      ...(message.fromNick === undefined ? {} : { fromNick: message.fromNick }),
      timestamp: message.timestamp,
      ...(handoff ? { handoff: true as const } : {}),
    });
    session.roomPending.set(roomJid, queued);
    void pumpRoom(session, roomJid).catch((error: unknown) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI group pump failed',
      );
    });
  }

  // One turn at a time per (AI, room). Messages arriving during a turn are
  // coalesced: when the turn ends, one more turn runs if new mentions came in.
  async function pumpRoom(session: AiSession, roomJid: string): Promise<void> {
    if (session.roomBusy.has(roomJid)) {
      return;
    }
    session.roomBusy.add(roomJid);
    try {
      while (!session.stopped) {
        const queued = session.roomPending.get(roomJid) ?? [];
        if (queued.length === 0) {
          break;
        }
        // T-0482: a delegated task is always its own turn. If it coalesced
        // with a mention or another delegation, only the last item would be
        // the trigger and the other delegation rows would stay `working`
        // forever. Mentions still coalesce with mentions.
        const nextDelegation = queued.findIndex((item) => item.delegationId !== undefined);
        const take = nextDelegation === -1 ? queued.length : Math.max(1, nextDelegation);
        const batch = queued.slice(0, take);
        session.roomPending.set(roomJid, queued.slice(take));
        await runGroupSessionTurn(session, roomJid, batch);
      }
    } finally {
      session.roomBusy.delete(roomJid);
    }
  }

  async function runGroupSessionTurn(
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
  ): Promise<void> {
    // The AI id below is the gateway's own: it keyed this session, so nothing
    // here can be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      return;
    }
    const gate = await loadRoomGateState(
      deps.db,
      room.groupId,
      deps.xmpp.domain,
      room.topicId,
    ).catch(() => null);
    if (gate === null) {
      logger.warn({ aiId: session.aiId, groupId: room.groupId }, 'AI group state lookup failed');
      return;
    }
    const eligible: RoomPendingMessage[] = [];
    for (const item of batch) {
      const fromBare = normBareJid(item.fromJid);
      if (isAiSender(fromBare)) {
        // T-0481: an AI sender passes only for a queued handoff, and only
        // while it is still a live session in this room. Everything else is
        // the old M2 ban.
        if (item.handoff !== true) {
          continue;
        }
        const senderSession = sessionForAiJid(fromBare);
        if (senderSession === undefined || !senderSession.rooms.has(roomJid)) {
          continue;
        }
        eligible.push(item);
        continue;
      }
      if (!item.fromResolved) {
        // The real JID is unknown: never a turn. That covers both spec
        // clauses at once — an occupant nick matching a room AI would be an
        // AI-to-AI turn, and anything else can't pass the human-membership
        // check below anyway.
        continue;
      }
      // Only a current human member's mention triggers a reply.
      if (!gate.memberJids.has(fromBare)) {
        continue;
      }
      eligible.push(item);
    }
    if (eligible.length === 0) {
      return;
    }
    const trigger = eligible[eligible.length - 1] as RoomPendingMessage;

    // T-0482: a delegated trigger that is dropped before the model call must
    // not leave its row `working` forever. Fails quietly: a lookup or update
    // error here only logs ids. A turn that does reach the model finishes its
    // row below with the worker's text.
    const failDelegationQuietly = async (delegationId: string | undefined): Promise<void> => {
      if (delegationId === undefined) {
        return;
      }
      try {
        await finishDelegation(deps.db, {
          id: delegationId,
          aiId: session.aiId,
          status: 'failed',
        });
      } catch (error) {
        logger.warn(
          { err: errorName(error), aiId: session.aiId, delegationId },
          'AI delegation finish failed',
        );
      }
    };

    // The soft daily limit is checked before the rate budget and any model
    // call: a limited AI sends at most one fixed notice per room per UTC day
    // (a plain room message, no mention) and further mentions get nothing.
    // The usage read also decides the 80% warnings, which go out after the
    // reply below — never for a skipped or rate-limited turn. The notice
    // goes through `liveSendMessage` so a stop that lands between the spend
    // read and the notice is silently dropped.
    const groupChatKey = `room:${roomJid}`;
    const groupBudget = await budgetGate.checkDailyLimit({
      aiId: session.aiId,
      chatKey: groupChatKey,
      sendNotice: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
    });
    if (groupBudget.limited) {
      await failDelegationQuietly(trigger.delegationId);
      return;
    }

    const atMs = nowMs();
    const recent = (session.roomTurns.get(roomJid) ?? []).filter(
      (stamp) => stamp > atMs - GROUP_RATE_WINDOW_MS,
    );
    if (recent.length >= GROUP_TURNS_PER_WINDOW) {
      session.roomTurns.set(roomJid, recent);
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        'AI group rate limit reached; dropping the turn',
      );
      await failDelegationQuietly(trigger.delegationId);
      return;
    }
    recent.push(atMs);
    session.roomTurns.set(roomJid, recent);

    // T-0479: at most ROUND_MAX_AI_TURNS AI turns per human message per room,
    // across every AI that message woke. The rate stamp just pushed is
    // refunded so a dropped turn does not consume rate budget. A missing round
    // (for example right after a restart) counts as a fresh one.
    const round = roomRounds.get(roomJid);
    if (round !== undefined && round.aiTurns >= ROUND_MAX_AI_TURNS) {
      recent.pop();
      session.roomTurns.set(roomJid, recent);
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        'AI round budget spent; dropping the turn',
      );
      await failDelegationQuietly(trigger.delegationId);
      return;
    }
    if (round !== undefined) {
      round.aiTurns += 1;
    }

    // T-0479: a pure listener wake (every eligible item is a wake, no mention
    // in the batch) shows the short "looking at this" line only once the turn
    // has passed every gate above. A mention turn never posts it.
    if (eligible.every((item) => item.wake === true)) {
      await liveSendMessage(session, roomJid, 'groupchat', `${room.nick} is looking at this`).catch(
        () => undefined,
      );
    }

    // The room history the AI reads for a turn is that topic's room only:
    // the `roomJid` above is the joined topic room, and `loadHistory` reads
    // that room alone. The trigger is always inside it (checked at enqueue).
    const senderName = displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick });
    // T-0109: names for the topic-aware system prompt. Best effort: a lookup
    // failure keeps the old generic prompt. The topic name goes to the model
    // alone, never into another topic's turn or any log line.
    let groupName: string | undefined;
    let topicName: string | undefined;
    try {
      const [groupRow] = await deps.db
        .select({ title: groups.title })
        .from(groups)
        .where(eq(groups.id, room.groupId))
        .limit(1);
      groupName = groupRow?.title;
    } catch {
      // Best effort: the turn still runs with the generic prompt.
    }
    if (room.topicId !== '') {
      try {
        const [topicRow] = await deps.db
          .select({ name: topics.name })
          .from(topics)
          .where(eq(topics.id, room.topicId))
          .limit(1);
        topicName = topicRow?.name;
      } catch {
        // Best effort: the turn still runs with the generic prompt.
      }
    }
    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(roomJid, 'groupchat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI group history lookup failed; replying without history',
        );
      }

      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      const memory = await loadMemoryContext({
        aiId: session.aiId,
        chatKey: groupChatKey,
        archiveOwner: roomJid,
        scope: { kind: 'room', room: roomJid },
        aiBareJid: normBareJid(ai.jid),
        now,
        virtualKey,
      });
      // The batch is newer than the archive may know: merge the eligible
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every mention that arrived, and the context
      // builder below deduplicates the trigger by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = eligible
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: roomJid,
          kind: 'groupchat' as const,
          fromJid: item.fromJid,
          fromResolved: item.fromResolved,
          ...(item.fromNick === undefined ? {} : { fromNick: item.fromNick }),
          body: item.body,
          timestamp: item.timestamp,
          outgoing: false,
        }));
      // T-0481: the other AIs in this room that may receive a handoff. T-0482:
      // the same read carries this AI's `canDelegate` and each target's AI id,
      // so the delegation tools can list the roster. One database read for the
      // turn; a lookup failure just means no targets and no delegation tools,
      // and the turn runs unchanged.
      const otherSessions = [...sessions.values()].filter(
        (candidate) => candidate.aiId !== session.aiId && candidate.rooms.has(roomJid),
      );
      let handoffTargets: { aiId: string; nick: string; jid: string }[] = [];
      let canDelegate = false;
      if (otherSessions.length > 0) {
        try {
          const rows = await deps.db
            .select({ id: ais.id, accepts: ais.acceptsDelegation, canDelegate: ais.canDelegate })
            .from(ais)
            .where(
              inArray(ais.id, [session.aiId, ...otherSessions.map((candidate) => candidate.aiId)]),
            );
          canDelegate = rows.find((row) => row.id === session.aiId)?.canDelegate ?? false;
          const accepting = new Set(rows.filter((row) => row.accepts).map((row) => row.id));
          handoffTargets = otherSessions.flatMap((candidate) => {
            const subscription = candidate.rooms.get(roomJid);
            if (subscription === undefined || !accepting.has(candidate.aiId)) {
              return [];
            }
            return [{ aiId: candidate.aiId, nick: subscription.nick, jid: candidate.aiJid }];
          });
        } catch {
          // Best effort: no handoff targets, the turn runs as before.
        }
      }
      const messages: ChatCompletionMessage[] = buildGroupMessages({
        aiName: ai.name,
        persona: ai.persona,
        senderName,
        today,
        aiJid: ai.jid,
        ...(groupName === undefined ? {} : { groupName }),
        ...(topicName === undefined ? {} : { topicName }),
        ...(handoffTargets.length === 0
          ? {}
          : { handoffNames: handoffTargets.map((target) => target.nick) }),
        history: [...history, ...fresh],
        trigger: { id: trigger.id, body: trigger.body },
        memory,
      });

      // T-0098/T-0444: decide per turn, from the database, whether the
      // trigger's sender is allowed to ask the AI for an action. The role
      // lives on the `roomGate` we already loaded; a plain `member`, an AI
      // sender or an unknown occupant does not get `request_action`. Every
      // room turn still carries the three memory tools (T-0444), so the tool
      // loop always runs.
      const triggerBare = normBareJid(trigger.fromJid);
      const triggerRole = gate.memberRolesByJid.get(triggerBare);
      const allowedForAction = triggerRole === 'owner' || triggerRole === 'admin';
      const actionsList = deps.actions?.listActions() ?? [];
      const allowActions = allowedForAction && actionsList.length > 0;
      // T-0482: offer the delegation tools only when this AI may delegate and
      // at least one accepting AI is in the room. The target list is the id
      // and room nick of each accepting session.
      const delegateTargets =
        canDelegate && handoffTargets.length > 0
          ? handoffTargets.map((target) => ({ id: target.aiId, name: target.nick }))
          : undefined;
      const groupTools = buildGroupTools(allowedForAction ? actionsList : [], delegateTargets);
      // The re-check callback runs at tool-execution time. A `plain
      // member` turn never offers `request_action`, so this never fires for
      // them; for an admin/owner turn it queries the same gate so a
      // demotion that landed between the mention and the tool call
      // short-circuits to `denied: not allowed` without invoking the
      // action gateway.
      const isStillAllowed = async (): Promise<boolean> => {
        const fresh = await loadRoomGateState(
          deps.db,
          room.groupId,
          deps.xmpp.domain,
          room.topicId,
        );
        if (fresh === null) {
          return false;
        }
        const role = fresh.memberRolesByJid.get(triggerBare);
        // T-0109: the sender must still be a group owner/admin AND a member
        // of this topic. Either check failing denies the action.
        return (role === 'owner' || role === 'admin') && fresh.memberJids.has(triggerBare);
      };

      // No persona tools in groups and no drafts: the reply goes straight to
      // the room with `composing`/`paused` chat states around it. The 80%
      // warnings go out after it, so the owner reads the answer first. The
      // `live*` wrappers drop the reply when the AI was stopped between the
      // mention arriving and the LLM call resolving. The room reply always
      // goes through the same tool loop as DMs (T-0098, extended by T-0444);
      // the executor carries the room's group id, the re-check callback and
      // whether `request_action` is allowed.
      // T-0106: the guide is appended to the last user turn only when tools
      // are enabled and the room offers `request_action`; the loop runs
      // `toolMaxRounds` rounds with a live progress message.
      const groupProgress = liveProgressReporter(session, roomJid, 'groupchat', ai.jid);
      const groupMessages =
        deps.toolsEnabled === true && allowActions ? withToolGuide(messages) : messages;
      const turnOutcome = await runGroupTurn({
        aiId: session.aiId,
        roomJid,
        triggerId: trigger.id,
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages: groupMessages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        tools: groupTools,
        executeTool: executeToolCall(session, groupChatKey, {
          groupId: room.groupId,
          topicId: room.topicId,
          roomJid,
          triggerId: trigger.id,
          isStillAllowed,
          allowActions,
          delegateTargetIds: new Set(delegateTargets?.map((target) => target.id) ?? []),
        }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        ...(handoffTargets.length === 0 ? {} : { handoffTargets }),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        reportProgress: groupProgress.reportProgress,
        clearProgress: groupProgress.clearProgress,
        // T-0156: the per-turn counts line (ids and counts only), like the
        // DM path below.
        turnLogger,
        sendMessage: (to, kind, text, opts) => liveSendMessage(session, to, kind, text, opts),
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      // T-0482: a delegated turn stores its result on the row. The worker's
      // posted text (with the `@<boss> ` prefix) is the stored summary; a
      // failed turn stores whatever was posted instead. Log ids only.
      if (trigger.delegationId !== undefined) {
        try {
          await finishDelegation(deps.db, {
            id: trigger.delegationId,
            aiId: session.aiId,
            status: turnOutcome.kind === 'replied' ? 'completed' : 'failed',
            resultSummary: turnOutcome.text,
          });
        } catch (error) {
          logger.warn(
            { err: errorName(error), aiId: session.aiId, delegationId: trigger.delegationId },
            'AI delegation finish failed',
          );
        }
      }
      await budgetGate.sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: groupChatKey,
        usage: groupBudget.usage,
        sendWarning: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      });
      startCompaction(session, groupChatKey, virtualKey);
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message in the room, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI group turn failed',
      );
      // T-0482: if this was a delegated turn, the model call never happened
      // (or the turn failed around it), so the row must not stay `working`.
      await failDelegationQuietly(trigger.delegationId);
      const reply = mapFailureToReply(error);
      const name = senderName.trim() === '' ? normBareJid(trigger.fromJid) : senderName.trim();
      try {
        await liveSendMessage(session, roomJid, 'groupchat', `@${name} ${reply}`, {
          replyTo: { id: trigger.id },
          mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }],
        });
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      try {
        liveSendTyping(session, roomJid, 'groupchat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
    }
  }

  // One turn at a time per AI. Messages arriving during a turn are coalesced:
  // when the turn ends, one more turn runs if new owner messages came in.
  async function pumpSession(session: AiSession): Promise<void> {
    if (session.busy) {
      return;
    }
    session.busy = true;
    try {
      while (session.pending.length > 0 && !session.stopped) {
        const batch = session.pending.splice(0, session.pending.length);
        await runSessionTurn(session, batch);
      }
    } finally {
      session.busy = false;
    }
  }

  async function runSessionTurn(session: AiSession, batch: PendingMessage[]): Promise<void> {
    // The owner JID comes from the database, never from the message. The AI
    // id below is the gateway's own: it keyed this session, so `ensureAiModel`
    // can never be aimed at an id taken from message content.
    const ai = await loadActiveAi(deps.db, session.aiId).catch(() => null);
    if (ai === null) {
      await disconnectAi(session.aiId).catch(() => undefined);
      return;
    }
    const ownerJid = jidFor(localpartFor(ai.owner), deps.xmpp.domain);
    const ownerBare = bareJid(ownerJid);
    // The owner always wins; other `ai-*` senders get no turn (which rules
    // out AI-to-AI loops) and strangers get none either.
    const ownerMessages: PendingMessage[] = [];
    for (const item of batch) {
      const from = bareJid(item.fromJid);
      if (from === ownerBare) {
        ownerMessages.push(item);
      } else if (isAiSender(from)) {
        // Another AI (or our own reflection): never a turn, never a loop.
      }
      // Anything else is a stranger and is ignored.
    }
    if (ownerMessages.length === 0) {
      // Strangers, other `ai-*` senders (no AI-to-AI loops) and anything else
      // get no turn and no LiteLLM call.
      return;
    }
    const trigger = ownerMessages[ownerMessages.length - 1] as PendingMessage;

    // The owner's ticks turn to read: one XEP-0333 displayed marker per turn
    // for the last owner message of the batch. `trigger.id` is the incoming
    // `ChatMessage.id`, the same id the owner's client stores and matches
    // received markers against (the archive stanza-id when known, else the
    // stanza id). Only owner messages are ever marked: strangers and other
    // AIs returned above, before this point. The `liveMarkDisplayed` wrapper
    // drops the marker when the AI was stopped between the message arriving
    // and the marker going out.
    liveMarkDisplayed(session, ownerJid, 'chat', trigger.id);

    // The soft daily limit holds even when the marker above already went out:
    // a limited AI answers with at most one notice per day, and further
    // messages that day get no reply and no notice. The usage read also
    // decides the 80% warnings, which go out after the reply below.
    const dmChatKey = `dm:${ownerBare}`;
    const dmBudget = await budgetGate.checkDailyLimit({
      aiId: session.aiId,
      chatKey: dmChatKey,
      sendNotice: (text) => liveSendMessage(session, ownerJid, 'chat', text),
    });
    if (dmBudget.limited) {
      return;
    }

    // Each turn streams its drafts to the owner under one turn id. The
    // publisher throttles (150 ms); the complete reply is flushed as a draft
    // right before the final XMPP send (`beforeFinalSend`), so the last
    // `draft` carries the final text; `end` always comes after the final XMPP
    // message below. Typing indicators stay exactly as before, for clients
    // without drafts.
    const turnDrafts = draftHub.publishTurn(ai.owner, ai.jid, randomUUID());
    let virtualKey: string | undefined;
    try {
      await ensureAiModel(aiDeps(), session.aiId);
      const [keyRow] = await deps.db
        .select({ encryptedKey: llmVirtualKeys.encryptedKey })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, session.aiId))
        .limit(1);
      if (!keyRow) {
        throw new Error(`AI ${session.aiId} has no virtual key`);
      }
      // Decrypted in memory only; never stored, logged or returned.
      virtualKey = (deps.cipher as KeyCipher).decrypt(keyRow.encryptedKey);

      let history: ChatMessage[] = [];
      try {
        const page = await session.core.loadHistory(ownerJid, 'chat', {
          max: DM_HISTORY_MESSAGE_LIMIT,
        });
        history = page.messages;
      } catch (historyError) {
        logger.warn(
          { err: toRedactedError(historyError, secretsFor(virtualKey)), aiId: session.aiId },
          'AI history lookup failed; replying without history',
        );
      }

      const ownerName = await loadOwnerName(deps.db, ai.owner);
      const now = (deps.now ?? (() => new Date()))();
      const today = now.toISOString().slice(0, 10);
      const memory = await loadMemoryContext({
        aiId: session.aiId,
        chatKey: dmChatKey,
        archiveOwner: ai.localpart,
        scope: { kind: 'dm', peer: ownerBare },
        aiBareJid: bareJid(ai.jid),
        ownerName,
        now,
        virtualKey,
      });
      // The batch is newer than the archive may know: merge the triggering
      // messages into the history (skipping ids MAM already returned) so a
      // coalesced turn sees every message that arrived, and the trigger below
      // deduplicates against the last one by id.
      const knownIds = new Set(history.map((message) => message.id));
      const fresh: ChatMessage[] = ownerMessages
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chatJid: session.aiJid,
          kind: 'chat' as const,
          fromJid: ownerJid,
          fromResolved: true,
          body: item.body,
          timestamp: now,
          outgoing: false,
        }));
      const messages: ChatCompletionMessage[] = buildDmMessages({
        aiName: ai.name,
        persona: ai.persona,
        ownerName,
        today,
        aiJid: ai.jid,
        ownerJid,
        history: [...history, ...fresh],
        trigger,
        memory,
      });
      // T-0106: the guide rides as a trailing user turn only when tools are
      // enabled and tool/routine adapters are registered (a non-empty
      // action list, so `request_action` is actually offered). Otherwise
      // today's messages, byte for byte.
      const dmActionsList = deps.actions?.listActions() ?? [];
      const dmMessages =
        deps.toolsEnabled === true && dmActionsList.length > 0 ? withToolGuide(messages) : messages;

      // `end` always comes after the final XMPP message: `runDmTurn` sends
      // it before resolving. Every send and draft push is gated by a
      // `live*` wrapper so a stop that lands between the LLM call and the
      // final send drops the reply (and every draft) instead of delivering
      // it. The `end` itself runs unconditionally so the owner's client
      // sees the turn terminate instead of hanging.
      // T-0106: multi-round turns post one live progress message at the
      // first tool round and update it per round; it is retracted when the
      // final text lands. Best effort: the turn never fails over it.
      const dmProgress = liveProgressReporter(session, ownerJid, 'chat', ai.jid);
      const outcome = await runDmTurn({
        aiId: session.aiId,
        ownerJid,
        messages: dmMessages,
        baseUrl: baseUrl,
        virtualKey,
        model: modelNameForAi(session.aiId),
        executeTool: executeToolCall(session, dmChatKey),
        tools: buildTools(deps.actions?.listActions() ?? []),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...(deps.toolMaxRounds === undefined ? {} : { maxRounds: deps.toolMaxRounds }),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        reportProgress: dmProgress.reportProgress,
        clearProgress: dmProgress.clearProgress,
        // T-0156: wires the per-turn counts line (ids and counts only,
        // never content) into production — the wire the T-0106 review
        // deferred.
        turnLogger,
        onDelta: (textSoFar) => {
          if (sessionIsLive(session)) {
            turnDrafts.push(textSoFar);
          }
        },
        beforeFinalSend: (text) => {
          if (sessionIsLive(session)) {
            turnDrafts.flush(text);
          }
        },
        sendMessage: (to, kind, text) => liveSendMessage(session, to, kind, text),
        sendTyping: (to, kind, state) => {
          liveSendTyping(session, to, kind, state);
        },
        logger,
        secrets: secretsFor(),
      });
      turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed');
      // The 80% heads-ups go out after the reply, so the owner reads the
      // answer first. A failed warning send only logs and never fails the
      // turn.
      await budgetGate.sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: dmChatKey,
        usage: dmBudget.usage,
        sendWarning: (text) => liveSendMessage(session, ownerJid, 'chat', text),
      });
      startCompaction(session, dmChatKey, virtualKey);
    } catch (error) {
      // ensureAiModel, the key lookup and anything else outside the turn: an
      // honest short message, never the raw error.
      logger.warn(
        { err: toRedactedError(error, secretsFor(virtualKey)), aiId: session.aiId },
        'AI turn failed',
      );
      const reply = mapFailureToReply(error);
      try {
        await liveSendMessage(session, ownerJid, 'chat', reply);
      } catch {
        // There is nobody left to tell when the send itself fails.
      }
      // The failed `end` goes out only after the failure text was sent (or
      // its send was attempted): the contract promises `end` comes last.
      try {
        liveSendTyping(session, ownerJid, 'chat', 'paused');
      } catch {
        // Typing state is best-effort.
      }
      turnDrafts.end('failed');
    }
  }

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    if (!config.enabled) {
      logger.info({}, 'agent gateway is disabled');
      return;
    }
    if (deps.litellm === undefined || deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs LiteLLM and the key cipher; staying off');
      return;
    }
    started = true;
    superseded.clear();
    await reconcile();
    unsubscribes.push(
      onAiLifecycle((event) => {
        if (!started) {
          return;
        }
        if (event.type === 'created' || event.type === 'resumed') {
          // `loadActiveAi` is the same `WHERE status = 'active'` filter the
          // periodic reconcile uses (T-0080): a `stopped` or `disabled` row
          // never wakes the gateway back up, even on the notifier path.
          void loadActiveAi(deps.db, event.aiId)
            .then((record) => {
              if (record !== null) {
                return connectAi(record);
              }
            })
            .catch((error: unknown) => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
                event.type === 'created'
                  ? 'AI post-create connect failed'
                  : 'AI post-resume connect failed',
              );
            });
        } else {
          // `stopped` and `deleted` both go through `disconnectAi`: the
          // session is removed from the map, `session.stopped` is set so
          // every send path skips, and queued turns are dropped with the
          // session. For `stopped` the periodic safety net never reconnects
          // (the row is no longer in `listActiveAisForGateway`); a delete
          // tears the row down on its own.
          void disconnectAi(event.aiId).catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              event.type === 'stopped'
                ? 'AI post-stop disconnect failed'
                : 'AI post-delete disconnect failed',
            );
          });
        }
      }),
      onGroupAi((event) => {
        if (!started) {
          return;
        }
        // A join or leave for a live session syncs right away; anything
        // missed (an AI with no session yet) is picked up by `reconcile`.
        // Only ids travel on the event.
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
      // T-0109: the sibling event for per-topic AI membership. A newly added
      // or removed membership shows up without waiting for the next full
      // reconcile, through the same right-away sync as the group event.
      onTopicAi((event) => {
        if (!started) {
          return;
        }
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
    );
    timer = setInterval(() => {
      if (started) {
        void reconcile();
      }
    }, reconcileIntervalMs);
  }

  async function stop(): Promise<void> {
    started = false;
    superseded.clear();
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    unsubscribes = [];
    for (const aiId of sessions.keys()) {
      try {
        await disconnectAi(aiId);
      } catch {
        // Shutdown disconnects everyone; one failure stops nothing else.
      }
    }
    roomListener.clearAll();
  }

  return {
    start,
    stop,
    reconcile,
    size: () => sessions.size,
    aiIds: () => [...sessions.keys()],
    postToChat,
  };
}
