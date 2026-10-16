// T-1290 review: the group turn's model/reply body, split out of
// `group-turn.ts` so no agent file exceeds the 400-line cap. A pure move:
// the code, wording and behaviour are unchanged.
import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { type ActiveAiForGateway } from '../../ais/service';
import type { AiUsage } from '../../ais/usage';
import { recordUsage } from '../../ais/usage-store';
import type { KeyCipher } from '../../connections/crypto';
import {
  buildGroupMessages,
  DM_HISTORY_MESSAGE_LIMIT,
  normBareJid,
  type ChatCompletionMessage,
} from '../context';
import { promptNow } from '../prompt-time';
import { timeZoneForJid } from '../../auth/profile-time-zone';
import { finishDelegation } from '../delegation/service';
import { runGroupTurn } from '../reply';
import { TOOL_STAGE_THINKING } from '../tool-guide';
import { buildGroupTools } from '../tools';
import {
  errorName,
  rememberRoomSentId,
  toRedactedError,
  type AiSession,
  type RoomPendingMessage,
  type RoomSubscription,
  type ScheduledTurnOutcome,
} from './contracts';
import type { RoomGateState } from './db';
import { resolveTurnDesk, TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER, type TurnDesk } from './desk-exec';
import { groupTurnAccess, makeIsStillAllowed } from './group-turn-access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { resolveHandoffRoster } from './group-turn-roster';
import { loadModelTarget } from './model-target';
import { createRoutineSend } from './routine-send';
import { clearTurnAbort, registerTurnAbort } from './stop';
import type { GroupTurnContext } from './group-turn';
import type { TurnLog } from '../log/append';
import { turnLimits } from './turn-rounds';

export interface GroupTurnBodyInput {
  ctx: GroupTurnContext;
  ai: ActiveAiForGateway;
  session: AiSession;
  roomJid: string;
  room: RoomSubscription;
  gate: RoomGateState;
  groupChatKey: string;
  groupBudget: { limited: boolean; usage: AiUsage | null };
  eligible: RoomPendingMessage[];
  trigger: RoomPendingMessage;
  senderName: string;
  groupName: string | undefined;
  topicName: string | undefined;
  /** T-1426: the turn's session log; its task id keys every row. */
  log: TurnLog;
  /** T-1290: filled with the decrypted key so the caller's failure path can
   * redact it from the log line without holding the key itself. */
  secretRef: { value?: string };
  /** T-1646: reports this turn's outcome for a scheduled routine's trigger. */
  settle: (outcome: ScheduledTurnOutcome) => void;
}

// T-1290 (AI-10): the room hears the fixed `GROUP_FAILURE_REPLY`; the owner
// hears the real reason by DM, at most once a day per room. The budget gate
// owns the day key (the `dailyLimitNotices` pattern) and the owner lookup.
export function notifyOwnerOfFailure(
  ctx: GroupTurnContext,
  session: AiSession,
  roomJid: string,
  reason: string,
): Promise<void> {
  return ctx.budgetGate.notifyOwnerOfFailure({
    aiId: session.aiId,
    roomJid,
    reason,
    send: (to, text) => ctx.liveSendMessage(session, to, 'chat', text),
  });
}

export function runGroupTurnBody(input: GroupTurnBodyInput): Effect.Effect<void> {
  const {
    ctx,
    ai,
    session,
    roomJid,
    room,
    gate,
    groupChatKey,
    groupBudget,
    eligible,
    trigger,
    senderName,
    groupName,
    topicName,
    log,
    secretRef,
    settle,
  } = input;
  const {
    deps,
    logger,
    turnLogger,
    sessions,
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    secretsFor,
    executeToolCall,
    withToolGuide,
  } = ctx;

  return Effect.gen(function* () {
    const target = yield* Effect.promise(() =>
      loadModelTarget(deps.db, deps.cipher as KeyCipher, session.aiId),
    );
    if (target === null) {
      // No active provider connection for this AI: the caller's failure path
      // sends the room the fixed failure text.
      throw new Error(`AI ${session.aiId} has no provider connection`);
    }
    secretRef.value = target.apiKey;

    const history = yield* Effect.promise(() =>
      session.core.loadHistory(roomJid, 'groupchat', {
        max: DM_HISTORY_MESSAGE_LIMIT,
      }),
    ).pipe(
      Effect.map((page): ChatMessage[] => page.messages),
      Effect.catchDefect((historyError) =>
        Effect.sync((): ChatMessage[] => {
          logger.warn(
            { err: toRedactedError(historyError, secretsFor(target.apiKey)), aiId: session.aiId },
            'AI group history lookup failed; replying without history',
          );
          return [];
        }),
      ),
    );

    const now = (deps.now ?? (() => new Date()))();
    const senderZone = yield* Effect.promise(() =>
      timeZoneForJid(deps.db, normBareJid(trigger.fromJid)),
    );
    const today = promptNow(now, senderZone);
    const memory = yield* Effect.promise(() =>
      loadMemoryContext({
        aiId: session.aiId,
        chatKey: groupChatKey,
        archiveOwner: roomJid,
        scope: { kind: 'room', room: roomJid },
        aiBareJid: normBareJid(ai.jid),
        now,
        secret: target.apiKey,
      }),
    );
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
    const roster = yield* resolveHandoffRoster(deps.db, sessions, session, roomJid);
    const { handoffTargets, canDelegate } = roster;
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

    const actionsList = deps.actions?.listActions() ?? [];
    const { scheduledTrigger, triggerBare, allowActions, allowDesk, askPeople, delegateTargets } =
      groupTurnAccess({
        trigger,
        gate,
        actionsList,
        canDelegate,
        handoffTargets,
        aiOwnerBare: normBareJid(jidFor(localpartFor(ai.owner), deps.xmpp.domain)),
      });
    // T-1423: resolve the AI's computer for this turn (cloud or its runner).
    // SEC-13b: a plain member's or another AI's mention must not use the
    // owner's computer, so the desk is not even resolved for those turns.
    const turnDesk: TurnDesk = allowDesk
      ? yield* Effect.promise(() => resolveTurnDesk(deps, ai))
      : { waiting: false };
    const deskEnabled = turnDesk.client !== undefined;
    const groupTools = buildGroupTools(allowActions ? actionsList : [], delegateTargets, {
      // T-1409: the desk tools ride the same flag as their executor.
      desk: deskEnabled,
      // T-1576: the question tool rides the same flag as its executor branch.
      askPeople,
    });
    const isStillAllowed = makeIsStillAllowed(deps.db, deps.xmpp.domain, room, triggerBare);

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
    // T-1714: a scheduled run posts one message per routine and edits it on
    // later runs; it shows no progress card and no waiting-for-computer stage.
    // A live turn keeps the T-1414 card exactly as before.
    const routineSend =
      trigger.scheduled === undefined
        ? null
        : createRoutineSend({
            db: deps.db,
            session,
            routineId: trigger.scheduled.routineId,
            isLive: (candidate) => !candidate.stopped && sessions.get(candidate.aiId) === candidate,
            now: deps.now ?? (() => new Date()),
            logger,
          });
    const groupProgress =
      routineSend === null
        ? liveProgressReporter(session, roomJid, 'groupchat', ai.jid, log)
        : null;
    if (turnDesk.waiting && groupProgress !== null) {
      yield* Effect.promise(() =>
        groupProgress.reportProgress(TOOL_STAGE_WAITING_FOR_YOUR_COMPUTER),
      );
    }
    const groupMessages =
      deps.toolsEnabled === true && allowActions ? withToolGuide(messages) : messages;
    // T-1422: the room turn's abort controller, keyed by the room JID (the
    // client chat id of a group/topic). The stop route aborts it.
    const groupAbort = registerTurnAbort(session, roomJid);
    const turnOutcome = yield* Effect.promise(() =>
      runGroupTurn({
        aiId: session.aiId,
        aiJid: ai.jid,
        roomJid,
        triggerId: trigger.id,
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages: groupMessages,
        target,
        signal: groupAbort.signal,
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        tools: groupTools,
        executeTool: executeToolCall(
          session,
          groupChatKey,
          {
            groupId: room.groupId,
            topicId: room.topicId,
            roomJid,
            triggerId: trigger.id,
            isStillAllowed,
            allowActions,
            askPeople,
            delegateTargetIds: new Set(delegateTargets?.map((entry) => entry.id) ?? []),
          },
          deskEnabled
            ? { ownerUserId: ai.owner, client: turnDesk.client, signal: groupAbort.signal }
            : undefined,
          // T-1655: a scheduled trigger's turn is unattended, so the action
          // gateway runs tier 0/1 and refuses a tier-2 request without a
          // standing rule with `needs_approval` instead of parking a card.
          { unattended: scheduledTrigger },
        ),
        ...turnLimits(deps.toolMaxRounds, deskEnabled),
        ...(handoffTargets.length === 0 ? {} : { handoffTargets }),
        checkRoundGate: () => budgetGate.checkDmRoundGate(session),
        onFailure: (reason) => notifyOwnerOfFailure(ctx, session, roomJid, reason),
        ...(groupProgress === null
          ? {}
          : {
              reportProgress: groupProgress.reportProgress,
              finishProgress: groupProgress.finishProgress,
            }),
        // T-0156: the per-turn counts line (ids and counts only), like the
        // DM path below.
        turnLogger,
        // T-1405: every model call in the turn adds its tokens and cost to the
        // AI's `ai_usage` row. Best effort and fire and forget; it can never
        // fail the turn.
        onUsage: (usage) => {
          void recordUsage(
            { db: deps.db, logger },
            session.aiId,
            target.usageProvider ?? target.provider,
            target.model,
            usage,
            (deps.now ?? (() => new Date()))(),
          );
        },
        sendMessage: async (to, kind, text, opts) => {
          const sent =
            routineSend === null
              ? await liveSendMessage(session, to, kind, text, opts)
              : await routineSend.send(to, kind, text);
          // T-1176 (AI-8): remember the id so a reply quoting this message
          // wakes the AI without a mention.
          rememberRoomSentId(session, roomJid, sent.id);
          return sent;
        },
        sendTyping: (to, kind, state) => {
          // T-1406: the room turn opens with the fixed "Thinking" status; tool
          // stages replace it and the final `paused` clears it.
          liveSendTyping(
            session,
            to,
            kind,
            state,
            state === 'composing' ? TOOL_STAGE_THINKING : undefined,
          );
        },
        logger,
        secrets: secretsFor(),
        log,
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => clearTurnAbort(session, roomJid, groupAbort))));
    // T-1646: report the turn's outcome for a scheduled routine's trigger
    // exactly once; a non-scheduled batch has nothing to settle. T-1657
    // (audit G3): a `replied` turn whose session stopped before the send
    // settles `stopped`.
    const sessionLive = !session.stopped && sessions.get(session.aiId) === session;
    settle(turnOutcome.kind === 'replied' && !sessionLive ? 'stopped' : turnOutcome.kind);
    // T-0482: a delegated turn stores its result on the row. The worker's
    // posted text (with the `@<boss> ` prefix) is the stored summary; a
    // failed turn stores whatever was posted instead. Log ids only.
    const finishedDelegationId = trigger.delegationId;
    if (finishedDelegationId !== undefined) {
      yield* Effect.promise(() =>
        finishDelegation(deps.db, {
          id: finishedDelegationId,
          aiId: session.aiId,
          status: turnOutcome.kind === 'replied' ? 'completed' : 'failed',
          resultSummary: turnOutcome.text,
        }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: errorName(error), aiId: session.aiId, delegationId: finishedDelegationId },
              'AI delegation finish failed',
            );
          }),
        ),
      );
    }
    yield* Effect.promise(() =>
      budgetGate.sendBudgetWarnings({
        aiId: session.aiId,
        chatKey: groupChatKey,
        usage: groupBudget.usage,
        sendWarning: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      }),
    );
    startCompaction(session, groupChatKey, target);
  });
}
