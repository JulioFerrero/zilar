import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { normBareJid } from '../context';
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
import { bodyAddressesAi } from './typed-mention';

// T-1176 (AI-8): a reply to the AI's own message wakes it, like Telegram,
// even without an `@` mention. Zilar's own clients quote a reply by id only
// (client-core's send paths carry no `to`), so the quoted id is matched
// against the ids this AI recently sent in the room. A third-party client
// that follows XEP-0461's optional `to` names the AI by its bare JID or by
// its MUC occupant JID (`room/nick`); both forms are matched too.
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

// T-0549 (plan §3, G8b): the group ingest side extracted from
// `createAgentGateway`. The factory takes the shared session maps, the room
// listener, the group turn runner and the gateway callbacks the moved code
// closes over, and returns the same `sessionForAiJid`, `handleRoomIncoming`
// and `pumpRoom` the gateway calls. A pure move: no logic or wording changed.
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
  function handleRoomIncoming(session: AiSession, message: ChatMessage): Promise<void> | undefined {
    // An edit or a retraction in a room is never a mention: it starts no turn.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    // T-1176 (AI-8): the AI's own room reflection comes back as `outgoing`
    // (xmpp-core's `resolve-sender.ts` marks a room message outgoing when the
    // sender is the AI's own occupant JID or nick). It is never a new turn,
    // but its `id` is the archive stanza-id (XEP-0359) that clients quote in
    // `replyTo.id`, and `originId` is the id the gateway chose when sending.
    // Remember both so a reply to this message wakes the AI. The turn's own
    // send records the sent id too; a duplicate is harmless.
    if (message.outgoing) {
      const ownRoomJid = normBareJid(message.chatJid);
      if (session.rooms.has(ownRoomJid)) {
        rememberRoomSentId(session, ownRoomJid, message.id);
        if (message.originId !== undefined) {
          rememberRoomSentId(session, ownRoomJid, message.originId);
        }
        // T-1579: re-key a question card's row from the origin id to the
        // stanza id a reply quotes. Best-effort, never awaited.
        void rekeyOnReflection(deps.db, session, message, logger);
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
    // T-0479: every human room message opens a fresh round, mention or not.
    // Every AI session receives the same stanza, so an id we already opened on
    // leaves the running count alone.
    if (!isAiSender(normBareJid(message.fromJid))) {
      // T-1579: a person's reply to a question card answers it, mention or not.
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
    // T-1617: a person who types the AI's nick or username instead of picking
    // it from the list wakes it too. Only a person's typed mention counts, so
    // two AIs cannot wake each other by naming one another.
    const mentioned =
      (message.mentions ?? []).some((mention) => normBareJid(mention.jid) === aiBare) ||
      replyTargetsAi({
        replyTo: message.replyTo,
        aiBare,
        aiOccupantJid: `${roomJid}/${room.nick}`,
        sentIds: session.roomSentIds.get(roomJid),
      }) ||
      (!isAiSender(fromBare) && bodyAddressesAi(body, [room.nick, aiBare.split('@')[0] ?? '']));
    // T-0475: the listener sees every human room message, mention or not,
    // before the mention early-return below. AI senders never feed it.
    if (deps.listener !== undefined && !isAiSender(normBareJid(message.fromJid))) {
      noteListenerMessage(roomJid, room, message, body);
    }
    if (!mentioned) {
      // T-1448/T-1529: the topic's follower — the last AI a person mentioned —
      // follows it: a plain human message reaches it with no `@`, until Stop
      // pauses it. AI senders never trigger following, so two AIs cannot loop.
      // The returned promise settles when the check is done; the gateway
      // ignores it, tests await it.
      return followTopic(session, message, roomJid, body);
    }
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
    } else {
      // T-1529: a person's mention or reply moves following to this AI. An AI
      // sender's mention is a handoff and changes nothing.
      setTopicFollower(roomJid, session.aiId);
    }
    queueRoomTurn(session, roomJid, message, body, handoff);
  }

  // T-1448/T-1529: the topic's follower is read asynchronously (the cache may
  // miss), so the follow check runs on the effect runtime like the pump. A
  // sender that is an AI, or a room this AI paused with Stop, is skipped
  // without a read; those paths return no promise. The returned promise
  // settles when the check is done, so a caller can wait for it instead of
  // guessing at a delay.
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

  // The queue step shared by a mention, a reply and a followed topic. Messages
  // arriving during a turn coalesce per room; the pump starts (or continues).
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
        // T-0482: a delegated task is always its own turn. If it coalesced
        // with a mention or another delegation, only the last item would be
        // the trigger and the other delegation rows would stay `working`
        // forever.
        // T-1290 (AI-9): mentions coalesce only when they come from the same
        // sender. A different sender starts a new turn that runs after this
        // one, so the reply is tagged to the person it answers, in order.
        const first = queued[0] as RoomPendingMessage;
        let take = 1;
        if (first.delegationId === undefined) {
          while (take < queued.length) {
            const item = queued[take];
            if (item === undefined || item.delegationId !== undefined) {
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
