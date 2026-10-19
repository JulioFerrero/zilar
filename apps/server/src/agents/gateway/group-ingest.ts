import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { normBareJid } from '../context';
import { decideWake, type WakeReason } from './addressing';
import {
  GROUP_JOIN_SKEW_MS,
  ROUND_MAX_HOPS,
  isAiSender,
  rememberRoomSentId,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
} from './contracts';
import type { createRoomListener } from './listener';
import { answerOnReply, rekeyOnReflection } from './question-answer';
import { followingAiFor, isFollowPaused, setTopicFollower } from './topic-follow';
import type { ServerDatabase } from '../../db/client';
import { rekeyCard } from '../../message-blocks/cards';
import { errorName } from '../../effect/error-utils';

// The AI's own blocks card comes back from the room as an outgoing reflection.
// Its `id` is the archive stanza id clients quote, while the row used the origin
// id, so a tap could never find it. A reflection can beat the insert, so a miss
// is retried with backoff. Failures log ids only and never break ingest.
// The waits between the first attempt and each retry.
const RETRY_DELAYS_MS = [300, 1000, 3000] as const;

async function rekeyCardOnReflection(
  db: ServerDatabase,
  session: AiSession,
  message: ChatMessage,
  logger: GatewayLogger,
): Promise<void> {
  const payload = message.payload;
  const originId = message.originId;
  if (payload?.type !== 'blocks' || originId === undefined || originId === message.id) {
    return;
  }
  const rekeyed = await Effect.runPromise(
    Effect.gen(function* () {
      for (const delayMs of RETRY_DELAYS_MS) {
        const updated = yield* Effect.tryPromise(() => rekeyCard(db, originId, message.id));
        if (updated) {
          return true;
        }
        yield* Effect.sleep(delayMs);
      }
      return yield* Effect.tryPromise(() => rekeyCard(db, originId, message.id));
    }).pipe(
      Effect.orElseSucceed((error) => {
        logger.warn({ aiId: session.aiId, err: errorName(error) }, 'AI card re-key failed');
        return false;
      }),
    ),
  );
  if (rekeyed) {
    logger.info({ aiId: session.aiId }, 'AI card re-keyed');
  }
}
// A reply to the AI's own message wakes it, like Telegram, even without an
// `@` mention: the quoted id is matched against the ids this AI recently sent
// in the room, including XEP-0461 `to` names (bare or MUC occupant JID).
export function replyTargetsAi(input: {
  replyTo: ChatMessage['replyTo'];
  aiBare: string;
  aiOccupantJid: string;
  sentIds?: readonly string[] | undefined;
}): boolean {
  const replyTo = input.replyTo;
  if (replyTo === undefined) {
    return false;
  }
  if (
    replyTo.to !== undefined &&
    (normBareJid(replyTo.to) === input.aiBare || replyTo.to === input.aiOccupantJid)
  ) {
    return true;
  }
  return input.sentIds?.includes(replyTo.id) ?? false;
}

interface GroupIngestContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  noteListenerMessage: ReturnType<typeof createRoomListener>['noteListenerMessage'];
  secretsFor: (secret?: string) => string[];
  runGroupSessionTurn: (
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
  ) => Promise<void>;
}

export function createGroupIngest(ctx: GroupIngestContext) {
  const {
    deps,
    logger,
    sessions,
    roomRounds,
    noteListenerMessage,
    secretsFor,
    runGroupSessionTurn,
  } = ctx;

  // The live session for an `ai-*` sender's bare JID, if this gateway runs
  // it. `sessions` is keyed by the gateway's own AI id, so match the JID.
  function sessionForAiJid(bare: string): AiSession | undefined {
    for (const candidate of sessions.values()) {
      if (normBareJid(candidate.aiJid) === bare) {
        return candidate;
      }
    }
    return undefined;
  }

  // A person @mentions AIs, and only those AIs reply. Every check that needs
  // no database runs here; the sender's membership and the rate limit are
  // checked fresh at turn time.
  function handleRoomIncoming(session: AiSession, message: ChatMessage): Promise<void> | undefined {
    // An edit or a retraction in a room is never a mention: it starts no turn.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    // The AI's own room reflection comes back as `outgoing` (xmpp-core's
    // `resolve-sender.ts`). It is never a new turn, but its `id` (XEP-0359
    // stanza-id) and `originId` are what clients quote, so remember both.
    if (message.outgoing) {
      const ownRoomJid = normBareJid(message.chatJid);
      const ownRoom = session.rooms.get(ownRoomJid);
      if (ownRoom !== undefined) {
        ownRoom.lastOwnReplyAtMs = Date.now();
        rememberRoomSentId(session, ownRoomJid, message.id);
        if (message.originId !== undefined) {
          rememberRoomSentId(session, ownRoomJid, message.originId);
        }
        void rekeyOnReflection(deps.db, session, message, logger);
        void rekeyCardOnReflection(deps.db, session, message, logger);
      }
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
    if (!isAiSender(normBareJid(message.fromJid))) {
      void answerOnReply(deps.db, session, message, logger);
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
    const fromBare = normBareJid(message.fromJid);
    if (isAiSender(fromBare) && fromBare !== aiBare) {
      room.lastOtherAiAtMs = Date.now();
    }
    const pickedMention = (message.mentions ?? []).some(
      (mention) => normBareJid(mention.jid) === aiBare,
    );
    const replied = replyTargetsAi({
      replyTo: message.replyTo,
      aiBare,
      aiOccupantJid: `${roomJid}/${room.nick}`,
      sentIds: session.roomSentIds.get(roomJid),
    });
    // A person who types the AI's nick or username instead of picking it from
    // the list wakes it too. Only a person's typed mention counts, so two AIs
    // cannot wake each other by naming one another.
    let wakeReason: WakeReason | null = null;
    if (!pickedMention && !replied && !isAiSender(fromBare)) {
      const liveAisInRoom = [...sessions.values()].filter((candidate) =>
        candidate.rooms.has(roomJid),
      ).length;
      wakeReason = decideWake({
        body,
        names: [room.nick, aiBare.split('@')[0] ?? ''],
        liveAisInRoom,
        lastOwnReplyAtMs: room.lastOwnReplyAtMs ?? null,
        otherAiRepliedSince: (room.lastOtherAiAtMs ?? 0) > (room.lastOwnReplyAtMs ?? 0),
        nowMs: Date.now(),
        rules: { oneAiQuestion: true, followUpQuestion: true },
      });
      if (wakeReason !== null) {
        logger.debug?.({ roomJid, aiId: session.aiId, reason: wakeReason }, 'AI woken by rule');
      }
    }
    const mentioned = pickedMention || replied || wakeReason !== null;
    // The listener sees every human room message, mention or not, before the
    // mention early-return below. AI senders never feed it.
    if (deps.listener !== undefined && !isAiSender(normBareJid(message.fromJid))) {
      noteListenerMessage(roomJid, room, message, body);
    }
    if (!mentioned) {
      // The topic's follower — the last AI a person mentioned — follows it: a
      // plain human message reaches it with no `@`, until Stop pauses it. AI
      // senders never trigger following, so two AIs cannot loop.
      return followTopic(session, message, roomJid, body);
    }
    let handoff = false;
    if (isAiSender(fromBare)) {
      // An AI mentioning another AI hands the question over, inside the
      // round's hop budget. The sender must be another live session joined to
      // this room — never a JID or nick taken from the message.
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
    } else {
      setTopicFollower(roomJid, session.aiId);
    }
    queueRoomTurn(session, roomJid, message, body, handoff);
  }

  function followTopic(
    session: AiSession,
    message: ChatMessage,
    roomJid: string,
    body: string,
  ): Promise<void> | undefined {
    if (isAiSender(normBareJid(message.fromJid)) || isFollowPaused(session.aiId, roomJid)) {
      return undefined;
    }
    return Effect.runPromise(
      Effect.promise(() => followingAiFor(deps.db, roomJid)).pipe(
        Effect.flatMap((followerAiId) =>
          Effect.sync(() => {
            // Re-check the pause: Stop can land while the follower lookup is
            // in flight, and it must suppress this follow too.
            if (followerAiId === session.aiId && !isFollowPaused(session.aiId, roomJid)) {
              queueRoomTurn(session, roomJid, message, body, false);
            }
          }),
        ),
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI topic follow check failed',
            );
          }),
        ),
      ),
    );
  }

  function queueRoomTurn(
    session: AiSession,
    roomJid: string,
    message: ChatMessage,
    body: string,
    handoff: boolean,
  ): void {
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
    Effect.runFork(
      pumpRoomEffect(session, roomJid).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI group pump failed',
            );
          }),
        ),
      ),
    );
  }

  // One turn at a time per (AI, room). Messages arriving during a turn are
  // coalesced: when the turn ends, one more turn runs if new mentions came in.
  // A failing turn rejects with its original error, after the room is freed.
  const pumpRoomEffect = Effect.fnUntraced(function* (
    session: AiSession,
    roomJid: string,
  ): Effect.fn.Return<void> {
    if (session.roomBusy.has(roomJid)) {
      return;
    }
    session.roomBusy.add(roomJid);
    yield* Effect.gen(function* () {
      while (!session.stopped) {
        const queued = session.roomPending.get(roomJid) ?? [];
        if (queued.length === 0) {
          break;
        }
        // A delegated task and a scheduled routine's trigger are always their
        // own turn: coalescing would drop their row `working` or their outcome.
        const first = queued[0] as RoomPendingMessage;
        let take = 1;
        if (first.delegationId === undefined && first.scheduled === undefined) {
          while (take < queued.length) {
            const item = queued[take];
            if (
              item === undefined ||
              item.delegationId !== undefined ||
              item.scheduled !== undefined
            ) {
              break;
            }
            if (normBareJid(item.fromJid) !== normBareJid(first.fromJid)) {
              break;
            }
            take += 1;
          }
        }
        const batch = queued.slice(0, take);
        session.roomPending.set(roomJid, queued.slice(take));
        yield* Effect.promise(() => runGroupSessionTurn(session, roomJid, batch));
      }
    }).pipe(Effect.ensuring(Effect.sync(() => session.roomBusy.delete(roomJid))));
  });

  function pumpRoom(session: AiSession, roomJid: string): Promise<void> {
    return Effect.runPromise(pumpRoomEffect(session, roomJid));
  }

  return { sessionForAiJid, handleRoomIncoming, pumpRoom };
}
