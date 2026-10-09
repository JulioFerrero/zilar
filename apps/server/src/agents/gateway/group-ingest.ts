import { Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { normBareJid } from '../context';
import {
  GROUP_JOIN_SKEW_MS,
  ROUND_MAX_HOPS,
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
} from './contracts';
import type { createRoomListener } from './listener';

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
  secretsFor: (virtualKey?: string) => string[];
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
      noteListenerMessage(roomJid, room, message, body);
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
        // forever. Mentions still coalesce with mentions.
        const nextDelegation = queued.findIndex((item) => item.delegationId !== undefined);
        const take = nextDelegation === -1 ? queued.length : Math.max(1, nextDelegation);
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
