import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { createXmppCore, type ChatMessage } from '@zilar/xmpp-core';
import { runSql } from '../effect/sql';
import { toApprovalRow, type ApprovalSqlRow } from '../approvals/queries';
import { sharedDraftHub } from '../drafts/hub';
import { normBareJid } from './context';
import {
  RECONCILE_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  toRedactedError,
  type AgentGateway,
  type AgentGatewayConfig,
  type AgentGatewayDeps,
  type AiSession,
  type RoomRound,
} from './gateway/contracts';
import { createBudgetGate } from './gateway/budget';
import { createRoomListener } from './gateway/listener';
import { createLiveSession } from './gateway/live';
import { createSessionLifecycle } from './gateway/sessions';
import { createMemoryRunner } from './gateway/memory';
import { createDmTurn } from './gateway/dm-turn';
import { createGroupIngest } from './gateway/group-ingest';
import { createGroupTurn } from './gateway/group-turn';
import { createGatewayLifecycle } from './gateway/lifecycle';
import { createStopTurn } from './gateway/stop';
import type { TurnWatcher } from './gateway/stop-types';
import { createToolExec } from './gateway/tool-exec';
import { createRoutineRunner } from './gateway/routine-run';
import { loadOwnerName } from './gateway/db';
import { randomUUID } from 'node:crypto';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { type ApprovalRow } from '../db/rows-agents';

export interface ApprovalFollowUpDeps {
  sessions: Map<string, AiSession>;
  sessionIsLive: (session: AiSession) => boolean;
  loadRoomJid: (groupId: string) => Effect.Effect<string | null>;
  loadTopicRoomJid: (topicId: string) => Effect.Effect<string | null>;
  loadOwnerName: (ownerId: string) => Promise<string>;
  domain: string;
  /** Fire-and-forget pumps for the two queues, like the routine runner's. A
   * kick while a turn is already in flight is a no-op: the running pump picks
   * the new item up when it loops. */
  kickDm: (session: AiSession) => void;
  kickRoom: (session: AiSession, roomJid: string) => void;
  loadApproval: (id: string) => Promise<ApprovalRow | null>;
}

interface ApprovalFollowUp {
  continueAfterApproval: (approvalId: string) => Promise<void>;
}

export function createApprovalFollowUp(deps: ApprovalFollowUpDeps): ApprovalFollowUp {
  async function continueAfterApproval(approvalId: string): Promise<void> {
    try {
      const row = await deps.loadApproval(approvalId);
      // A missing row, a still-open request, a deny, or a decision without a
      // decider never queues a turn. A `consumed` row does: the action ran,
      // and the AI now needs to see its result and carry on.
      if (
        row === null ||
        row.status === 'pending' ||
        row.status === 'denied' ||
        row.decidedBy === null
      ) {
        return;
      }
      // A routine card's result is its check line plus the routine's own
      // message, so approving it queues no follow-up turn.
      if (row.action.startsWith('routine.')) {
        return;
      }
      const session = deps.sessions.get(row.aiId);
      if (session === undefined || !deps.sessionIsLive(session)) {
        return;
      }
      const fromJid = jidFor(localpartFor(row.decidedBy), deps.domain);
      const body = `Approved: "${row.summary}". Continue the task from where you stopped. Do not repeat what you already said.`;

      if (row.groupId === null) {
        session.pending.push({ id: randomUUID(), body, fromJid, synthetic: true });
        deps.kickDm(session);
        return;
      }

      const roomJid =
        row.topicId === null
          ? await Effect.runPromise(deps.loadRoomJid(row.groupId))
          : await Effect.runPromise(deps.loadTopicRoomJid(row.topicId));
      if (roomJid === null || !session.rooms.has(roomJid)) {
        return;
      }
      const fromNick = await deps.loadOwnerName(row.decidedBy);
      const queued = session.roomPending.get(roomJid) ?? [];
      queued.push({
        id: randomUUID(),
        body,
        fromJid,
        fromResolved: true,
        fromNick,
        timestamp: new Date(),
        synthetic: true,
      });
      session.roomPending.set(roomJid, queued);
      deps.kickRoom(session, roomJid);
    } catch {
      // The approvals route's hook logs a throw; a failure here must not leak
      // a row or a user into a log line.
    }
  }

  return { continueAfterApproval };
}

// Agent gateway: keeps every active AI online over XMPP and replies to its
// owner in their DM. The AI id always comes from the gateway's own connection
// map, never from message content.
export function createAgentGateway(
  deps: AgentGatewayDeps,
  config: AgentGatewayConfig,
): AgentGateway & TurnWatcher {
  const logger = deps.logger;
  const turnLogger = deps.turnLogger ?? deps.logger;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const retryBaseMs = config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  const createCore = deps.createCore ?? createXmppCore;
  const draftHub = deps.drafts?.hub ?? sharedDraftHub;
  const sessions = new Map<string, AiSession>();
  // The per-turn stop hook, backed by the live session map.
  const { stopTurn } = createStopTurn(sessions);
  // AIs another gateway replaced while this process runs: `reconcile` and
  // retries never reconnect them until restart. In memory, keyed by AI id.
  const superseded = new Set<string>();
  // The live-session wrappers and `postToChat`, shared by the turns,
  // the room listener and the budget gate. Both take `sessionIsLive` as a
  // value, so the factory must run before them.
  const {
    sessionIsLive,
    liveSendMessage,
    liveProgressReporter,
    liveSendTyping,
    liveMarkDisplayed,
    postToChat,
    correctInRoom,
    loadOwnerId,
    loadRoomJid,
    loadTopicRoomJid,
  } = createLiveSession({ sessions, deps, logger, secretsFor, roomJidFor });
  // Per-room round budgets (see RoomRound). In memory: a restart
  // safely resets it, a fresh start can only wake fewer AIs.
  const roomRounds = new Map<string, RoomRound>();
  const roomListener = createRoomListener({
    deps,
    logger,
    secretsFor,
    sessions,
    roomRounds,
    sessionIsLive,
    isStarted: () => lifecycle.isStarted(),
    pumpRoom: (session, roomJid) => pumpRoom(session, roomJid),
  });

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
    isStarted: () => lifecycle.isStarted(),
    handleIncoming: (session, message) => handleIncoming(session, message),
    dropRoomListenerIfUnused: (roomJid) => roomListener.dropRoomListenerIfUnused(roomJid),
  });

  function nowMs(): number {
    return (deps.now ?? (() => new Date()))().getTime();
  }

  function roomJidFor(roomLocalpart: string): string {
    return normBareJid(`${roomLocalpart}@${deps.xmpp.mucDomain}`);
  }

  function secretsFor(secret?: string): string[] {
    return secret === undefined ? [] : [secret];
  }

  const budgetGate = createBudgetGate({ deps, logger, sessionIsLive, secretsFor });

  const { loadMemoryContext, startCompaction } = createMemoryRunner({
    deps,
    logger,
    secretsFor,
    nowMs,
    toRedactedError,
    checkDmRoundGate: budgetGate.checkDmRoundGate,
  });

  const { executeToolCall, withToolGuide } = createToolExec({
    deps,
    logger,
    sessions,
    roomRounds,
    sessionIsLive,
    pumpRoom: (session, roomJid) => pumpRoom(session, roomJid),
    secretsFor,
    liveSendMessage,
  });

  const { pumpSessionEffect } = createDmTurn({
    deps,
    logger,
    turnLogger,
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
    executeToolCall,
    withToolGuide,
    draftHub,
  });

  const { sessionForAiJid, handleRoomIncoming, pumpRoom } = createGroupIngest({
    deps,
    logger,
    sessions,
    roomRounds,
    noteListenerMessage: roomListener.noteListenerMessage,
    secretsFor,
    runGroupSessionTurn: (session, roomJid, batch) => runGroupSessionTurn(session, roomJid, batch),
  });

  const { runGroupSessionTurn } = createGroupTurn({
    deps,
    logger,
    turnLogger,
    sessions,
    roomRounds,
    sessionForAiJid: (bare) => sessionForAiJid(bare),
    liveSendMessage,
    liveSendTyping,
    liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi,
    secretsFor,
    executeToolCall,
    withToolGuide,
    nowMs,
  });

  const lifecycle = createGatewayLifecycle({
    deps,
    config,
    logger,
    reconcileIntervalMs,
    secretsFor,
    sessions,
    superseded,
    connectAi,
    disconnectAi,
    syncAiRooms,
    clearAllListeners: () => roomListener.clearAll(),
  });
  const { start, stop, reconcile } = lifecycle;

  function handleIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction of a message is never a new turn, in a DM or in a
    // room: the AI re-answering edits is out of scope. This is the first check,
    // before any routing, pairing, database or model work.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    // A gateway that is stopping refuses new turns. Incoming messages reach the
    // per-session core listeners, which stay attached until `disconnectAi`, so
    // without this check a message landing mid-drain would start a turn the
    // drain never waits on. `started` is false from the first line of
    // `stopEffect`.
    if (!lifecycle.isStarted()) {
      return;
    }
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    if (message.kind === 'groupchat') {
      handleRoomIncoming(session, message);
      return;
    }
    if (message.kind !== 'chat' || message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    session.pending.push({ id: message.id, body, fromJid: message.fromJid });
    kickDm(session);
  }

  // The fire-and-forget DM pump fork. `busy` is reset in the pump's `finally`,
  // but an unexpected throw still needs a redacted log line instead of an
  // unhandled rejection.
  function kickDm(session: AiSession): void {
    Effect.runFork(
      pumpSessionEffect(session).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI pump failed',
            );
          }),
        ),
      ),
    );
  }

  // The routine runner's room kick: it awaits the turn's outcome, never the
  // pump's promise, whose own `catchDefect` logs a failure.
  function kickRoom(session: AiSession, roomJid: string): void {
    void pumpRoom(session, roomJid).catch((error) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI group pump failed',
      );
    });
  }

  // The routine scheduler's port: queues a routine's synthetic trigger on the
  // AI's own queue and resolves with the turn's outcome; never reached from the
  // network.
  const { runScheduledTurn } = createRoutineRunner({
    sessions,
    sessionIsLive,
    loadOwnerId,
    loadRoomJid,
    loadTopicRoomJid,
    loadOwnerName: (ownerId) => loadOwnerName(deps.db, ownerId),
    domain: deps.xmpp.domain,
    kickDm,
    kickRoom,
  });

  // The approvals route asks the AI to continue its task after a person
  // decides. The row read mirrors `approvals/service.ts`.
  async function loadApproval(id: string): Promise<ApprovalRow | null> {
    const [raw] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals WHERE id = ${id} LIMIT 1`;
      }),
    );
    return raw === undefined ? null : toApprovalRow(raw);
  }

  const { continueAfterApproval } = createApprovalFollowUp({
    sessions,
    sessionIsLive,
    loadRoomJid,
    loadTopicRoomJid,
    loadOwnerName: (ownerId) => loadOwnerName(deps.db, ownerId),
    domain: deps.xmpp.domain,
    kickDm,
    kickRoom,
    loadApproval,
  });

  return {
    start,
    stop,
    reconcile,
    size: () => sessions.size,
    aiIds: () => [...sessions.keys()],
    // The ids of the live sessions with a turn in flight in one room, so the
    // topic activity read model can mark those AIs as working.
    runningAiIds: (roomJid: string) => {
      const ids: string[] = [];
      for (const session of sessions.values()) {
        if (session.roomBusy.has(roomJid)) {
          ids.push(session.aiId);
        }
      }
      return ids;
    },
    postToChat,
    correctInRoom,
    stopTurn,
    runScheduledTurn,
    continueAfterApproval,
  };
}
