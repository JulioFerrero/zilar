import { Effect } from 'effect';
import type { ChatMessage, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { ActiveAiForGateway } from '../../ais/service';
import { issueXmppToken } from '../../xmpp/token';
import {
  GATEWAY_RESOURCE,
  XMPP_TOKEN_TTL_SECONDS,
  attempt,
  cancelTimer,
  retryDelayMs,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
} from './contracts';
import { listAiRooms } from './db';

// T-0534 (plan §3, G5b): the session lifecycle extracted from
// `createAgentGateway`. It takes the shared maps and the callbacks for the
// gateway code that stays behind, and returns the same functions the gateway
// calls. A pure move: no logic or wording changed.
interface SessionLifecycleContext {
  sessions: Map<string, AiSession>;
  superseded: Set<string>;
  deps: Pick<AgentGatewayDeps, 'db' | 'xmpp'>;
  createCore: (options: XmppCoreOptions) => XmppCore;
  retryBaseMs: number;
  logger: GatewayLogger;
  secretsFor: (virtualKey?: string) => string[];
  roomJidFor: (roomLocalpart: string) => string;
  nowMs: () => number;
  isStarted: () => boolean;
  handleIncoming: (session: AiSession, message: ChatMessage) => void;
  dropRoomListenerIfUnused: (roomJid: string) => void;
}

export function createSessionLifecycle(ctx: SessionLifecycleContext) {
  const {
    sessions,
    superseded,
    deps,
    createCore,
    retryBaseMs,
    logger,
    secretsFor,
    roomJidFor,
    nowMs,
    isStarted,
    handleIncoming,
    dropRoomListenerIfUnused,
  } = ctx;

  function scheduleRetry(session: AiSession): void {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    session.retryAttempt += 1;
    const delay = retryDelayMs(session.retryAttempt, retryBaseMs);
    cancelTimer(session.retryTimer);
    // The pending reconnect is a fiber that sleeps, then reconnects; the
    // fiber clears the field first so a later cancel never touches it.
    session.retryTimer = Effect.runFork(
      Effect.sleep(delay).pipe(Effect.andThen(Effect.suspend(() => reconnect(session)))),
    );
  }

  function reconnect(session: AiSession): Effect.Effect<void> {
    session.retryTimer = undefined;
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return Effect.void;
    }
    return attempt(() => session.core.connect()).pipe(
      Effect.map(() => {
        session.retryAttempt = 0;
      }),
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI reconnect failed; retrying',
          );
          scheduleRetry(session);
        }),
      ),
    );
  }

  const connectAiEffect = Effect.fnUntraced(function* (
    record: ActiveAiForGateway,
  ): Effect.fn.Return<void> {
    if (!isStarted() || sessions.has(record.id) || superseded.has(record.id)) {
      return;
    }
    const aiId = record.id;
    const aiJid = record.jid;
    const created = yield* Effect.try({
      try: () =>
        createCore({
          service: deps.xmpp.wsPublicUrl,
          domain: deps.xmpp.domain,
          resource: GATEWAY_RESOURCE,
          getToken: () =>
            Effect.runPromise(
              attempt(() => issueXmppToken(deps.xmpp, aiJid, XMPP_TOKEN_TTL_SECONDS)).pipe(
                Effect.map((issued) => ({ jid: aiJid, token: issued.token })),
              ),
            ),
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI client could not be created',
          );
          return undefined;
        }),
      ),
    );
    if (created === undefined) {
      return;
    }
    const core: XmppCore = created;

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

    const connected = yield* attempt(() => core.connect()).pipe(
      Effect.map(() => {
        session.retryAttempt = 0;
        return true;
      }),
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          // One AI failing to connect must never stop the others; the retry
          // timer and the reconcile loop pick it up later.
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI failed to connect; retrying',
          );
          scheduleRetry(session);
          return false;
        }),
      ),
    );
    if (!connected) {
      return;
    }
    // The gateway may have stopped while the login was in flight: never keep
    // a connection nobody owns any more.
    if (!isStarted() || session.stopped || sessions.get(aiId) !== session) {
      yield* disconnectAiEffect(aiId).pipe(Effect.catchCause(() => Effect.void));
      return;
    }
    // Rooms never break DMs: a room sync failure is logged inside and the
    // session stays up for DMs either way.
    yield* syncAiRoomsEffect(session, record.name);
  });

  const disconnectAiEffect = Effect.fnUntraced(function* (aiId: string): Effect.fn.Return<void> {
    const session = sessions.get(aiId);
    if (session === undefined) {
      return;
    }
    sessions.delete(aiId);
    for (const roomJid of session.rooms.keys()) {
      dropRoomListenerIfUnused(roomJid);
    }
    session.stopped = true;
    cancelTimer(session.retryTimer);
    session.retryTimer = undefined;
    // Unsubscribing is best-effort during shutdown.
    yield* Effect.forEach(session.unsubs, (unsub) =>
      Effect.try({ try: unsub, catch: (error) => error }).pipe(Effect.ignore),
    );
    session.unsubs = [];
    yield* attempt(() => session.core.disconnect()).pipe(
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn({ err: toRedactedError(error, secretsFor()), aiId }, 'AI disconnect failed');
        }),
      ),
    );
    logger.info({ aiId }, 'AI is offline');
  });

  // Drifts the AI's room joins toward the database: joins every room the AI
  // belongs to with the AI's name as nick, re-joins when the nick went stale,
  // and leaves rooms the AI no longer belongs to. A join failure is logged
  // (ids only) and retried by the next reconcile; it never throws and never
  // breaks the AI's DMs.
  const syncAiRoomsEffect = Effect.fnUntraced(function* (
    session: AiSession,
    aiName: string,
  ): Effect.fn.Return<void> {
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    const rooms = yield* attempt(() => listAiRooms(deps.db, session.aiId)).pipe(
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
            'AI rooms lookup failed',
          );
          return null;
        }),
      ),
    );
    if (rooms === null) {
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
        yield* leaveRoomQuietlyEffect(session, roomJid, known.groupId);
      }
      const joined = yield* attempt(() => session.core.joinRoom(roomJid, aiName)).pipe(
        Effect.as(true),
        Effect.catch((error: unknown) =>
          Effect.sync(() => {
            logger.warn(
              {
                err: toRedactedError(error, secretsFor()),
                aiId: session.aiId,
                groupId: room.groupId,
              },
              'AI room join failed; reconcile will retry',
            );
            return false;
          }),
        ),
      );
      if (!joined) {
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
        yield* leaveRoomQuietlyEffect(session, roomJid, sub.groupId);
      }
    }
  });

  const leaveRoomQuietlyEffect = Effect.fnUntraced(function* (
    session: AiSession,
    roomJid: string,
    groupId: string,
  ): Effect.fn.Return<void> {
    session.rooms.delete(roomJid);
    session.roomPending.delete(roomJid);
    session.roomBusy.delete(roomJid);
    // A re-added AI starts with a fresh rate budget.
    session.roomTurns.delete(roomJid);
    dropRoomListenerIfUnused(roomJid);
    const left = yield* attempt(() => session.core.leaveRoom(roomJid)).pipe(
      Effect.as(true),
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId: session.aiId, groupId },
            'AI room leave failed',
          );
          return false;
        }),
      ),
    );
    if (!left) {
      return;
    }
    logger.info({ aiId: session.aiId, groupId }, 'AI left the room');
  });

  // The factory keeps its Promise-typed methods: callers outside this file
  // still await them.
  const connectAi = (record: ActiveAiForGateway): Promise<void> =>
    Effect.runPromise(connectAiEffect(record));
  const disconnectAi = (aiId: string): Promise<void> => Effect.runPromise(disconnectAiEffect(aiId));
  const syncAiRooms = (session: AiSession, aiName: string): Promise<void> =>
    Effect.runPromise(syncAiRoomsEffect(session, aiName));
  const leaveRoomQuietly = (session: AiSession, roomJid: string, groupId: string): Promise<void> =>
    Effect.runPromise(leaveRoomQuietlyEffect(session, roomJid, groupId));

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
    Effect.runFork(disconnectAiEffect(session.aiId).pipe(Effect.catchCause(() => Effect.void)));
  }

  return { scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly, handleReplaced };
}
