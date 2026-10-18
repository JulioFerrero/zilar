import { Effect } from 'effect';
import { displayNameOf, normBareJid, type ChatCompletionMessage } from '../context';
import { finishDelegation } from '../delegation/service';
import { GROUP_FAILURE_REPLY, type ExecuteToolCall } from '../tool-loop';
import { failureLogFields, mapFailureToReply } from '../tool-exec';
import {
  errorName,
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
  type ScheduledTurnOutcome,
} from './contracts';
import { checkRoomLimits, sendRoomRateNotice } from './room-limits';
import { loadGroupTitle, loadRoomGateState, loadTopicName } from './db';
import type { createBudgetGate } from './budget';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';
import type { DeskTurnContext } from './desk-exec';
import { notifyOwnerOfFailure, runGroupTurnBody } from './group-turn-body';
import { settleFor } from './scheduled-settle';
import { startTurn } from './turn-start';
import { openTurnLog } from '../log/append';
import { senderNamesByJid } from '../../xmpp/archive-sender';

type LiveSession = ReturnType<typeof createLiveSession>;

// Per-turn context for a `request_action` call in a group. The
// `groupId` and `topicId` are the room the AI was woken in — they ride
// along to the action gateway and are used to pick the model-facing
// wording. The `isStillAllowed` callback re-queries the database right
// before the action gateway runs, so a role change that landed between
// the turn starting and the tool executing short-circuits to
// `denied: not allowed` without calling the gateway. `allowActions` is
// false when the trigger may not ask for one, so an improvised
// `request_action` gets `invalid: unknown tool`.
export interface RequestActionContext {
  groupId: string;
  topicId: string;
  roomJid: string;
  triggerId: string;
  isStillAllowed: () => Promise<boolean>;
  allowActions: boolean;
  askPeople: boolean;
  delegateTargetIds: ReadonlySet<string>;
}

export interface GroupTurnContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  turnLogger: GatewayLogger;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  sessionForAiJid: (bare: string) => AiSession | undefined;
  liveSendMessage: LiveSession['liveSendMessage'];
  liveSendTyping: LiveSession['liveSendTyping'];
  liveProgressReporter: LiveSession['liveProgressReporter'];
  budgetGate: ReturnType<typeof createBudgetGate>;
  loadMemoryContext: MemoryRunner['loadMemoryContext'];
  startCompaction: MemoryRunner['startCompaction'];
  disconnectAi: (aiId: string) => Promise<void>;
  secretsFor: (secret?: string) => string[];
  executeToolCall: (
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
    desk?: DeskTurnContext,
    options?: { unattended?: boolean },
  ) => ExecuteToolCall;
  withToolGuide: (messages: ChatCompletionMessage[]) => ChatCompletionMessage[];
  nowMs: () => number;
}

export function createGroupTurn(ctx: GroupTurnContext) {
  const {
    deps,
    logger,
    roomRounds,
    sessionForAiJid,
    liveSendMessage,
    liveSendTyping,
    budgetGate,
    disconnectAi,
    secretsFor,
    nowMs,
  } = ctx;

  // The Promise-typed calls below are lifted with plain `Effect.promise`: a
  // rejection (or a synchronous throw) dies with the original error, and
  // `catchDefect` handles it where the old code had a `catch`.
  const runGroupSessionTurnEffect = Effect.fnUntraced(function* (
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
    settle: (outcome: ScheduledTurnOutcome) => void,
  ): Effect.fn.Return<void> {
    const ai = yield* startTurn({ db: deps.db, disconnectAi }, session, batch, settle);
    if (ai === null) return;
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      settle('offline');
      return;
    }
    const gate = yield* Effect.promise(() =>
      loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain, room.topicId),
    ).pipe(Effect.catchDefect(() => Effect.succeed(null)));
    if (gate === null) {
      logger.warn({ aiId: session.aiId, groupId: room.groupId }, 'AI group state lookup failed');
      settle('failed');
      return;
    }
    const eligible: RoomPendingMessage[] = [];
    for (const item of batch) {
      if (item.scheduled !== undefined) {
        // A routine's trigger, never from the network. Admitted before the
        // AI-sender, `fromResolved` and member checks: its owner may not be a
        // room member.
        eligible.push(item);
        continue;
      }
      const fromBare = normBareJid(item.fromJid);
      if (isAiSender(fromBare)) {
        // An AI sender passes only for a queued handoff, and only while it is
        // still a live session in this room. Everything else is banned.
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

    // A delegated trigger dropped before the model call must not leave its
    // row `working` forever; a failed lookup or update only logs ids.
    const failDelegationQuietly = Effect.fnUntraced(function* (
      delegationId: string | undefined,
    ): Effect.fn.Return<void> {
      if (delegationId === undefined) {
        return;
      }
      yield* Effect.promise(() =>
        finishDelegation(deps.db, {
          id: delegationId,
          aiId: session.aiId,
          status: 'failed',
        }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: errorName(error), aiId: session.aiId, delegationId },
              'AI delegation finish failed',
            );
          }),
        ),
      );
    });

    // The soft daily limit is checked before the rate budget and any model
    // call: a limited AI sends one fixed notice per room per UTC day, and the
    // notice goes through `liveSendMessage` so a concurrent stop drops it.
    const groupChatKey = `room:${roomJid}`;
    const groupBudget = yield* Effect.promise(() =>
      budgetGate.checkDailyLimit({
        aiId: session.aiId,
        chatKey: groupChatKey,
        sendNotice: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
      }),
    );
    if (groupBudget.limited) {
      yield* failDelegationQuietly(trigger.delegationId);
      settle('limited');
      return;
    }

    // The rate window and the per-message round budget live in
    // `room-limits.ts`. A rate drop tells the asker once per window; a round
    // drop never does (AIs answering each other is expected).
    const atMs = nowMs();
    const limit = checkRoomLimits({ roomTurns: session.roomTurns, roomRounds, roomJid, atMs });
    if (limit !== 'ok') {
      if (limit === 'rate') {
        yield* sendRoomRateNotice({
          notices: session.roomRateNotices,
          roomJid,
          atMs,
          send: (text) => liveSendMessage(session, roomJid, 'groupchat', text),
        }).pipe(Effect.catchDefect(() => Effect.void));
      }
      logger.warn(
        { aiId: session.aiId, groupId: room.groupId, messageId: trigger.id },
        limit === 'rate'
          ? 'AI group rate limit reached; dropping the turn'
          : 'AI round budget spent; dropping the turn',
      );
      yield* failDelegationQuietly(trigger.delegationId);
      settle('limited');
      return;
    }

    if (eligible.every((item) => item.wake === true)) {
      yield* Effect.promise(() =>
        liveSendMessage(session, roomJid, 'groupchat', `${room.nick} is looking at this`),
      ).pipe(Effect.catchDefect(() => Effect.void));
    }

    // The history is the joined topic's room only. The trigger's label is its
    // database name when resolved; a nick is free text and labels only an
    // unresolved sender, and a failed lookup falls back to the bare JID.
    const triggerNames = yield* Effect.promise(() =>
      senderNamesByJid(deps.db, [trigger.fromJid]),
    ).pipe(Effect.catchDefect(() => Effect.succeed(new Map<string, string>())));
    const senderName = displayNameOf(
      {
        fromJid: trigger.fromJid,
        fromResolved: trigger.fromResolved,
        ...(trigger.fromNick === undefined ? {} : { fromNick: trigger.fromNick }),
      },
      triggerNames,
    );
    // Names for the topic-aware system prompt. Best effort: a lookup failure
    // keeps the generic prompt. The topic name goes to the model alone, never
    // into another topic's turn or any log line.
    const groupName = yield* Effect.promise(() => loadGroupTitle(deps.db, room.groupId)).pipe(
      Effect.map((title) => title ?? undefined),
      Effect.catchDefect(() => Effect.succeed(undefined)),
    );
    let topicName: string | undefined;
    if (room.topicId !== '') {
      topicName = yield* Effect.promise(() => loadTopicName(deps.db, room.topicId)).pipe(
        Effect.map((name) => name ?? undefined),
        Effect.catchDefect(() => Effect.succeed(undefined)),
      );
    }
    const secretRef: { value?: string } = {};
    const turnLog = openTurnLog(deps.db, logger, session.aiId, ai.owner, roomJid, secretsFor());
    yield* runGroupTurnBody({
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
      log: turnLog,
      secretRef,
      settle,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.gen(function* () {
          // The connection lookup and anything else outside the turn: an
          // honest short message in the room, never the raw error.
          logger.warn(
            { err: toRedactedError(error, secretsFor(secretRef.value)), aiId: session.aiId },
            'AI group turn failed',
          );
          turnLog.append('error', failureLogFields(error));
          settle('failed');
          // If this was a delegated turn, the model call never happened (or
          // the turn failed around it), so the row must not stay `working`.
          yield* failDelegationQuietly(trigger.delegationId);
          const reason = mapFailureToReply(error);
          // The owner hears the real reason (once a day per room); the room
          // only hears the fixed reply.
          yield* Effect.promise(() => notifyOwnerOfFailure(ctx, session, roomJid, reason)).pipe(
            Effect.catchDefect((notifyError) =>
              Effect.sync(() => {
                logger.warn(
                  { err: errorName(notifyError), aiId: session.aiId },
                  'AI failure notice failed',
                );
              }),
            ),
          );
          // There is nobody left to tell when the send itself fails.
          // a scheduled run's failure is recorded by the scheduler; it
          // posts no @mention fallback in the room.
          if (trigger.scheduled === undefined) {
            yield* Effect.promise(() =>
              liveSendMessage(
                session,
                roomJid,
                'groupchat',
                GROUP_FAILURE_REPLY,
                trigger.synthetic === true ? {} : { replyTo: { id: trigger.id } },
              ),
            ).pipe(Effect.catchDefect(() => Effect.void));
          }
          // Typing state is best-effort.
          yield* Effect.try({
            try: () => liveSendTyping(session, roomJid, 'groupchat', 'paused'),
            catch: (typingError) => typingError,
          }).pipe(Effect.ignore);
        }),
      ),
    );
  });
  return {
    runGroupSessionTurn: (
      session: AiSession,
      roomJid: string,
      batch: RoomPendingMessage[],
    ): Promise<void> => {
      // The once-only settle for this batch: `ensuring` reports the catch-all
      // 'failed' after every exit (an already-settled item is skipped).
      const settle = settleFor(batch);
      return Effect.runPromise(
        runGroupSessionTurnEffect(session, roomJid, batch, settle).pipe(
          Effect.ensuring(Effect.sync(() => settle('failed'))),
        ),
      );
    },
  };
}
