import { Effect } from 'effect';
import { type AiServiceDeps } from '../../ais/service';
import { displayNameOf, normBareJid, type ChatCompletionMessage } from '../context';
import { finishDelegation } from '../delegation/service';
import { GROUP_FAILURE_REPLY, mapFailureToReply, type ExecuteToolCall } from '../reply';
import {
  errorName,
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
} from './contracts';
import { checkRoomLimits, sendRoomRateNotice } from './room-limits';
import { loadActiveAi, loadGroupTitle, loadRoomGateState, loadTopicName } from './db';
import type { createBudgetGate } from './budget';
import type { createLiveSession } from './live';
import type { MemoryRunner } from './memory';
import { notifyOwnerOfFailure, runGroupTurnBody } from './group-turn-body';

type LiveSession = ReturnType<typeof createLiveSession>;

// T-0546 (plan §3, G8a): the group/topic turn extracted from
// `createAgentGateway`. The factory takes the shared session maps, the live
// session, the budget gate, the memory runner and the gateway callbacks the
// moved code closes over, and returns the same `runGroupSessionTurn` the
// gateway's `pumpRoom` calls. A pure move: no logic or wording changed.
// Per-turn context for a `request_action` call in a group (T-0098). The
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

export interface GroupTurnContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  turnLogger: GatewayLogger;
  baseUrl: string;
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
  secretsFor: (virtualKey?: string) => string[];
  aiDeps: () => AiServiceDeps;
  executeToolCall: (
    session: AiSession,
    chatKey: string,
    context?: RequestActionContext,
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
  ): Effect.fn.Return<void> {
    // The AI id below is the gateway's own: it keyed this session, so nothing
    // here can be aimed at an id taken from message content.
    const ai = yield* Effect.promise(() => loadActiveAi(deps.db, session.aiId)).pipe(
      Effect.catchDefect(() => Effect.succeed(null)),
    );
    if (ai === null) {
      yield* Effect.promise(() => disconnectAi(session.aiId)).pipe(
        Effect.catchDefect(() => Effect.void),
      );
      return;
    }
    const room = session.rooms.get(roomJid);
    if (room === undefined) {
      return;
    }
    const gate = yield* Effect.promise(() =>
      loadRoomGateState(deps.db, room.groupId, deps.xmpp.domain, room.topicId),
    ).pipe(Effect.catchDefect(() => Effect.succeed(null)));
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
    // call: a limited AI sends at most one fixed notice per room per UTC day
    // (a plain room message, no mention) and further mentions get nothing.
    // The usage read also decides the 80% warnings, which go out after the
    // reply below — never for a skipped or rate-limited turn. The notice
    // goes through `liveSendMessage` so a stop that lands between the spend
    // read and the notice is silently dropped.
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
      return;
    }

    // T-1176 (AI-7): the rate window and the per-message round budget live in
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
          askerName: displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick }),
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
      return;
    }

    // T-0479: a pure listener wake (every eligible item is a wake, no mention
    // in the batch) shows the short "looking at this" line only once the turn
    // has passed every gate above. A mention turn never posts it.
    if (eligible.every((item) => item.wake === true)) {
      yield* Effect.promise(() =>
        liveSendMessage(session, roomJid, 'groupchat', `${room.nick} is looking at this`),
      ).pipe(Effect.catchDefect(() => Effect.void));
    }

    // The room history the AI reads for a turn is that topic's room only:
    // the `roomJid` above is the joined topic room, and `loadHistory` reads
    // that room alone. The trigger is always inside it (checked at enqueue).
    const senderName = displayNameOf({ fromJid: trigger.fromJid, fromNick: trigger.fromNick });
    // T-0109: names for the topic-aware system prompt. Best effort: a lookup
    // failure keeps the old generic prompt. The topic name goes to the model
    // alone, never into another topic's turn or any log line.
    // Best effort: the turn still runs with the generic prompt.
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
    const virtualKeyRef: { value?: string } = {};
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
      virtualKeyRef,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.gen(function* () {
          // ensureAiModel, the key lookup and anything else outside the turn: an
          // honest short message in the room, never the raw error.
          logger.warn(
            { err: toRedactedError(error, secretsFor(virtualKeyRef.value)), aiId: session.aiId },
            'AI group turn failed',
          );
          // T-0482: if this was a delegated turn, the model call never happened
          // (or the turn failed around it), so the row must not stay `working`.
          yield* failDelegationQuietly(trigger.delegationId);
          const reason = mapFailureToReply(error);
          const name = senderName.trim() === '' ? normBareJid(trigger.fromJid) : senderName.trim();
          // T-1290 (AI-10): the owner hears the real reason (once a day per
          // room); the room only hears the fixed reply.
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
          yield* Effect.promise(() =>
            liveSendMessage(session, roomJid, 'groupchat', `@${name} ${GROUP_FAILURE_REPLY}`, {
              replyTo: { id: trigger.id },
              mentions: [{ jid: normBareJid(trigger.fromJid), begin: 0, end: name.length + 1 }],
            }),
          ).pipe(Effect.catchDefect(() => Effect.void));
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
    ): Promise<void> => Effect.runPromise(runGroupSessionTurnEffect(session, roomJid, batch)),
  };
}
