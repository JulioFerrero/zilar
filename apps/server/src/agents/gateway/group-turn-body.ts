import { Effect } from 'effect';
import type { ActiveAiForGateway } from '../../ais/queries';
import { runGroupTurn } from '../group-turn';
import { buildGroupTools } from '../tools/definitions';
import type { AiUsage } from '../../ais/usage';
import type { KeyCipher } from '../../connections/crypto';
import { DM_HISTORY_MESSAGE_LIMIT, normBareJid } from '../context';
import { finishDelegation } from '../delegation/service';
import {
  rememberRoomSentId,
  type AiSession,
  type RoomPendingMessage,
  type RoomSubscription,
  type ScheduledTurnOutcome,
} from './contracts';
import { type RoomGateState, loadDelegationFlags, loadRoomGateState } from './db';
import { answerOpenQuestionsOnTurn } from './question-answer';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { loadModelTarget } from './model-target';
import type { GroupTurnContext } from './group-turn';
import type { TurnLog } from '../log/append';
import type { ServerDatabase } from '../../db/client';
import { loadTurnPrompt } from './turn-prompt';
import { errorName } from '../../effect/error-utils';
import { prepareTurn } from './turn-wiring';

export interface HandoffTarget {
  aiId: string;
  nick: string;
  jid: string;
}

// The other AIs in this room that may receive a handoff. The same read carries
// this AI's `canDelegate` and each target's AI id, so the delegation tools can
// list the roster. A lookup failure just means no targets and no tools.
export const resolveHandoffRoster = (
  db: ServerDatabase,
  sessions: Map<string, AiSession>,
  session: AiSession,
  roomJid: string,
): Effect.Effect<{ handoffTargets: HandoffTarget[]; canDelegate: boolean }> =>
  Effect.gen(function* () {
    const otherSessions = [...sessions.values()].filter(
      (candidate) => candidate.aiId !== session.aiId && candidate.rooms.has(roomJid),
    );
    let handoffTargets: HandoffTarget[] = [];
    let canDelegate = false;
    if (otherSessions.length > 0) {
      // Best effort: no handoff targets, the turn runs as before.
      yield* Effect.promise(() =>
        loadDelegationFlags(db, [
          session.aiId,
          ...otherSessions.map((candidate) => candidate.aiId),
        ]),
      ).pipe(
        Effect.map((rows) => {
          canDelegate = rows.find((row) => row.id === session.aiId)?.canDelegate ?? false;
          const accepting = new Set(rows.filter((row) => row.accepts).map((row) => row.id));
          handoffTargets = otherSessions.flatMap((candidate) => {
            const subscription = candidate.rooms.get(roomJid);
            if (subscription === undefined || !accepting.has(candidate.aiId)) {
              return [];
            }
            return [{ aiId: candidate.aiId, nick: subscription.nick, jid: candidate.aiJid }];
          });
        }),
        Effect.catchDefect(() => Effect.void),
      );
    }
    return { handoffTargets, canDelegate };
  });

interface GroupTurnAccessInput {
  trigger: RoomPendingMessage;
  gate: RoomGateState;
  actionsList: ReadonlyArray<{ name: string; description: string; argsExample?: string }>;
  canDelegate: boolean;
  handoffTargets: HandoffTarget[];
  /** SEC-13b: the AI owner's bare JID, so a turn they trigger may use the
   * AI's computer even when they are only a plain room member. */
  aiOwnerBare: string;
}

export interface GroupTurnAccess {
  scheduledTrigger: boolean;
  triggerBare: string;
  allowedForAction: boolean;
  allowActions: boolean;
  allowDesk: boolean;
  askPeople: boolean;
  delegateTargets: { id: string; name: string }[] | undefined;
}

export function groupTurnAccess(input: GroupTurnAccessInput): GroupTurnAccess {
  const { trigger, gate, actionsList, canDelegate, handoffTargets, aiOwnerBare } = input;
  // Decide per turn, from the database, whether the trigger's sender may ask
  // the AI for an action. Any human member who can see the topic qualifies:
  // `memberRolesByJid` holds human members only, so an AI sender, an unknown
  // occupant or an AI handoff has no role and never qualifies. Every room turn
  // still carries the three memory tools, so the tool loop always runs.
  // A scheduled routine's creator was checked at approval, so its trigger may
  // ask for an action; the run is marked unattended, so `request_action` stays
  // on for tier 0/1 while `ask_people` and delegation stay off.
  const scheduledTrigger = trigger.scheduled !== undefined;
  const triggerBare = normBareJid(trigger.fromJid);
  const triggerRole = gate.memberRolesByJid.get(triggerBare);
  const allowedForAction =
    scheduledTrigger || (triggerRole !== undefined && trigger.handoff !== true);
  const allowActions = allowedForAction && actionsList.length > 0;
  // The AI's computer is used only when the AI's owner, or a room owner or
  // admin, triggers the turn. A scheduled routine counts too, because its
  // creator was checked at approval. A plain member's approval-free action
  // request still must not reach it.
  const allowDesk =
    scheduledTrigger ||
    triggerRole === 'owner' ||
    triggerRole === 'admin' ||
    triggerBare === aiOwnerBare;
  // `ask_people` is offered only when a person triggered the turn. An
  // AI-to-AI handoff, a `delegate`-queued trigger or a scheduled routine never
  // gets the question tool.
  const askPeople = !scheduledTrigger && trigger.handoff !== true;
  // Offer the delegation tools only when this AI may delegate and at least one
  // accepting AI is in the room. The target list is each accepting session's id
  // and room nick.
  const delegateTargets =
    !scheduledTrigger && canDelegate && handoffTargets.length > 0
      ? handoffTargets.map((target) => ({ id: target.aiId, name: target.nick }))
      : undefined;
  return {
    scheduledTrigger,
    triggerBare,
    allowedForAction,
    allowActions,
    allowDesk,
    askPeople,
    delegateTargets,
  };
}

// The re-check callback runs at tool-execution time. Any human member may ask,
// so it requires only that the sender is still a member of this topic; a
// membership removed between the mention and the tool call short-circuits to
// `denied: not allowed` without invoking the action gateway.
function makeIsStillAllowed(
  db: ServerDatabase,
  domain: string,
  room: RoomSubscription,
  triggerBare: string,
): () => Promise<boolean> {
  return (): Promise<boolean> =>
    Effect.runPromise(
      Effect.promise(() => loadRoomGateState(db, room.groupId, domain, room.topicId)).pipe(
        Effect.map((fresh) => {
          if (fresh === null) {
            return false;
          }
          // The sender must still be a member of this topic. A member
          // removed mid-turn, or an unknown sender, is denied.
          return fresh.memberJids.has(triggerBare);
        }),
      ),
    );
}
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
  log: TurnLog;
  /** Filled with the decrypted key so the caller's failure path can redact it
   * from the log line without holding the key itself. */
  secretRef: { value?: string };
  settle: (outcome: ScheduledTurnOutcome) => void;
}

// The room hears the fixed `GROUP_FAILURE_REPLY`; the owner
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
    sessions,
    liveSendMessage,
    budgetGate,
    startCompaction,
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

    const roster = yield* resolveHandoffRoster(deps.db, sessions, session, roomJid);
    const { handoffTargets, canDelegate } = roster;
    const messages = yield* Effect.promise(() =>
      loadTurnPrompt({
        ctx,
        ai,
        session,
        target,
        chat: { kind: 'group', jid: roomJid, key: groupChatKey, limit: DM_HISTORY_MESSAGE_LIMIT },
        items: eligible,
        trigger,
        senderName,
        groupName,
        topicName,
        handoffNames: handoffTargets.map((target) => target.nick),
      }),
    );

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
    if (askPeople && trigger.synthetic !== true) {
      yield* Effect.promise(() =>
        answerOpenQuestionsOnTurn(deps.db, session, trigger, roomJid, logger),
      );
    }
    // A plain member's or another AI's mention must not use the owner's
    // computer, so the desk is not even resolved for those turns.
    const { routineSend, signal, common, deskOptions, deskEnabled, ensureCleared } =
      yield* prepareTurn({
        ctx,
        session,
        ai,
        target,
        chatJid: roomJid,
        kind: 'groupchat',
        log,
        isLive: (candidate) => !candidate.stopped && sessions.get(candidate.aiId) === candidate,
        useDesk: allowDesk,
        ...(trigger.scheduled === undefined ? {} : { routineId: trigger.scheduled.routineId }),
      });
    const groupTools = buildGroupTools(allowActions ? actionsList : [], delegateTargets, {
      desk: deskEnabled,
      askPeople,
    });
    const isStillAllowed = makeIsStillAllowed(deps.db, deps.xmpp.domain, room, triggerBare);

    // The room reply uses the shared group tool loop, with the guide on the
    // last user turn when tools are on; a scheduled run posts one message per
    // routine and edits it, while a live turn keeps a progress card.
    const turnOutcome = yield* Effect.promise(() =>
      runGroupTurn({
        ...common,
        aiId: session.aiId,
        aiJid: ai.jid,
        roomJid,
        triggerId: trigger.id,
        ...(trigger.synthetic === true ? { syntheticTrigger: true } : {}),
        senderJid: normBareJid(trigger.fromJid),
        senderName,
        messages: deps.toolsEnabled === true && allowActions ? withToolGuide(messages) : messages,
        target,
        signal,
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
          deskOptions,
          // A scheduled trigger's turn is unattended, so the action gateway
          // runs tier 0/1 and refuses a tier-2 request without a standing rule
          // instead of parking a card.
          { unattended: scheduledTrigger, signal },
        ),
        ...(handoffTargets.length === 0 ? {} : { handoffTargets }),
        onFailure: (reason) => notifyOwnerOfFailure(ctx, session, roomJid, reason),
        sendMessage: async (to, kind, text, opts) => {
          const sent =
            routineSend === null
              ? await liveSendMessage(session, to, kind, text, opts)
              : await routineSend.send(to, kind, text);
          rememberRoomSentId(session, roomJid, sent.id);
          return sent;
        },
      }),
    ).pipe(Effect.ensuring(ensureCleared));
    // Report the turn's outcome for a scheduled routine's trigger exactly
    // once; a non-scheduled batch has nothing to settle. A `replied` turn whose
    // session stopped before the send settles `stopped`.
    const sessionLive = !session.stopped && sessions.get(session.aiId) === session;
    settle(turnOutcome.kind === 'replied' && !sessionLive ? 'stopped' : turnOutcome.kind);
    // A delegated turn stores its result on the row: the reply text, or
    // whatever was posted for a failed or card turn (empty text gets a fixed
    // summary). Log ids only.
    const finishedDelegationId = trigger.delegationId;
    if (finishedDelegationId !== undefined) {
      const resultSummary =
        turnOutcome.kind === 'replied' && turnOutcome.text.trim() === ''
          ? 'Posted a card in the room.'
          : turnOutcome.text;
      yield* Effect.promise(() =>
        finishDelegation(deps.db, {
          id: finishedDelegationId,
          aiId: session.aiId,
          status: turnOutcome.kind === 'replied' ? 'completed' : 'failed',
          resultSummary,
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
