import { createXmppCore, type ChatMessage } from '@zilar/xmpp-core';
import { DEFAULT_LITELLM_BASE_URL, type LitellmAdminClient } from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import {
  listActiveAisForGateway,
  onAiLifecycle,
  revertPersonaFromChat,
  setPersonaFromChat,
  type ActiveAiForGateway,
  type AiServiceDeps,
} from '../ais/service';
import type { KeyCipher } from '../connections/crypto';
import { sharedDraftHub } from '../drafts/hub';
import { onGroupAi, onTopicAi } from '../groups/events';
import { normBareJid, type ChatCompletionMessage } from './context';
import { TOOL_GUIDE } from './tool-guide';
import { looksLikeSecret } from './memory/secrets';
import { addFact, recallMemory, zoomMemory } from './memory/store';
import { type ExecuteToolCall, type ToolExecution, type ValidToolCall } from './reply';
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
} from './tools';
import { createDelegation, getDelegationForAi } from './delegation/service';
import type { RequestOutcome } from '../actions/gateway';
import {
  GROUP_JOIN_SKEW_MS,
  RECONCILE_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  ROUND_MAX_HOPS,
  denialReasonForModel,
  errorName,
  formatModelText,
  isAiSender,
  toRedactedError,
  type AgentGateway,
  type AgentGatewayConfig,
  type AgentGatewayDeps,
  type AiSession,
  type RoomRound,
} from './gateway/contracts';
import { createBudgetGate } from './gateway/budget';
import { loadActiveAi } from './gateway/db';
import { createRoomListener } from './gateway/listener';
import { createLiveSession } from './gateway/live';
import { createSessionLifecycle } from './gateway/sessions';
import { createMemoryRunner } from './gateway/memory';
import { createDmTurn } from './gateway/dm-turn';
import { createGroupTurn, type RequestActionContext } from './gateway/group-turn';

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
  // T-0529: the live-session wrappers and `postToChat`, shared by the turns,
  // the room listener and the budget gate. Both take `sessionIsLive` as a
  // value, so the factory must run before them.
  const {
    sessionIsLive,
    liveSendMessage,
    liveProgressReporter,
    liveSendTyping,
    liveMarkDisplayed,
    postToChat,
  } = createLiveSession({ sessions, deps, logger, secretsFor, roomJidFor });
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

  // T-0534 (plan §3, G5b): the session lifecycle lives in
  // `agents/gateway/sessions.ts`. The factory takes the shared maps and the
  // callbacks for the gateway code that stays here; the destructured names
  // keep every call site below unchanged.
  const { connectAi, disconnectAi, syncAiRooms } = createSessionLifecycle({
    sessions,
    superseded,
    deps,
    createCore,
    retryBaseMs,
    logger,
    secretsFor,
    roomJidFor,
    nowMs,
    isStarted: () => started,
    handleIncoming: (session, message) => handleIncoming(session, message),
    dropRoomListenerIfUnused: (roomJid) => roomListener.dropRoomListenerIfUnused(roomJid),
  });

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

  // T-0540 (plan §3, G7): the DM turn lives in `agents/gateway/dm-turn.ts`.
  // This is a pure move: the factory takes the live session, the budget gate,
  // the memory runner and the gateway callbacks the moved code closes over,
  // and the destructured name keeps `handleIncoming`'s call site unchanged.
  const { pumpSession } = createDmTurn({
    deps,
    logger,
    turnLogger,
    baseUrl,
    sessionIsLive,
    liveSendMessage,
    liveSendTyping,
    liveMarkDisplayed,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    aiDeps,
    executeToolCall,
    withToolGuide,
    draftHub,
  });

  // T-0546 (plan §3, G8a): the group/topic turn lives in
  // `agents/gateway/group-turn.ts`. This is a pure move: the factory takes
  // the shared session maps, the live session, the budget gate, the memory
  // runner and the gateway callbacks the moved code closes over, and the
  // destructured name keeps `pumpRoom`'s call site unchanged.
  const { runGroupSessionTurn } = createGroupTurn({
    deps,
    logger,
    turnLogger,
    baseUrl,
    sessions,
    roomRounds,
    sessionForAiJid,
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    aiDeps,
    executeToolCall,
    withToolGuide,
    nowMs,
  });

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

  // T-0106: appends the fixed tool guide to the last user turn. The system
  // prompt builders take no options (their shape is frozen for provider
  // caching), so the guide rides as a separate user turn right before the
  // trigger. Only called when tools are enabled and adapters are
  // registered; otherwise the messages pass through untouched.
  function withToolGuide(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return [...messages, { role: 'user', content: TOOL_GUIDE }];
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
