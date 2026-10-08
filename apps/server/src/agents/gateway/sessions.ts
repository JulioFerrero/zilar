import type { ChatMessage, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { ActiveAiForGateway } from '../../ais/service';
import { issueXmppToken } from '../../xmpp/token';
import {
  GATEWAY_RESOURCE,
  XMPP_TOKEN_TTL_SECONDS,
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

  async function connectAi(record: ActiveAiForGateway): Promise<void> {
    if (!isStarted() || sessions.has(record.id) || superseded.has(record.id)) {
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
    if (!isStarted() || session.stopped || sessions.get(aiId) !== session) {
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
      dropRoomListenerIfUnused(roomJid);
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
    dropRoomListenerIfUnused(roomJid);
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

  return { scheduleRetry, connectAi, disconnectAi, syncAiRooms, leaveRoomQuietly, handleReplaced };
}
