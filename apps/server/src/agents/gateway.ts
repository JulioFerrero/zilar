import { createXmppCore, type ChatMessage } from '@zilar/xmpp-core';
import { DEFAULT_LITELLM_BASE_URL, type LitellmAdminClient } from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import {
  listActiveAisForGateway,
  onAiLifecycle,
  type ActiveAiForGateway,
  type AiServiceDeps,
} from '../ais/service';
import type { KeyCipher } from '../connections/crypto';
import { sharedDraftHub } from '../drafts/hub';
import { onGroupAi, onTopicAi } from '../groups/events';
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
import { loadActiveAi } from './gateway/db';
import { createRoomListener } from './gateway/listener';
import { createLiveSession } from './gateway/live';
import { createSessionLifecycle } from './gateway/sessions';
import { createMemoryRunner } from './gateway/memory';
import { createDmTurn } from './gateway/dm-turn';
import { createGroupIngest } from './gateway/group-ingest';
import { createGroupTurn } from './gateway/group-turn';
import { createToolExec } from './gateway/tool-exec';

export type {
  AgentGateway,
  AgentGatewayConfig,
  AgentGatewayDeps,
  GatewayLogger,
} from './gateway/contracts';
export {
  GATEWAY_RESOURCE,
  GROUP_JOIN_SKEW_MS,
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  LISTENER_EVERY_N_DEFAULT,
  LISTENER_QUIET_MS_DEFAULT,
  RECONCILE_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  ROUND_MAX_AI_TURNS,
  ROUND_MAX_HOPS,
} from './gateway/contracts';

// Agent gateway v0: keeps every active AI online over XMPP and replies to the
// AI's owner in their DM. The AI id always comes from the gateway's own
// connection map, never from message content. Reconnects are xmpp-core's own
// auto-reconnect plus this module's backoff on failed connects and the
// periodic reconcile as a safety net.
export function createAgentGateway(
  deps: AgentGatewayDeps,
  config: AgentGatewayConfig,
): AgentGateway {
  const logger = deps.logger;
  const turnLogger = deps.turnLogger ?? deps.logger;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  const retryBaseMs = config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  const createCore = deps.createCore ?? createXmppCore;
  const baseUrl = deps.litellmBaseUrl ?? DEFAULT_LITELLM_BASE_URL;
  const draftHub = deps.drafts?.hub ?? sharedDraftHub;
  const sessions = new Map<string, AiSession>();
  // AIs another gateway replaced while this process runs. `reconcile` and
  // retries never reconnect them again until the gateway restarts. In memory
  // only, keyed by the gateway's own AI ids.
  const superseded = new Set<string>();
  // T-0529: the live-session wrappers and `postToChat`, shared by the turns,
  // the room listener and the budget gate. Both take `sessionIsLive` as a
  // value, so the factory must run before them.
  const {
    sessionIsLive,
    liveSendMessage,
    liveProgressReporter,
    liveSendTyping,
    liveMarkDisplayed,
    postToChat,
  } = createLiveSession({ sessions, deps, logger, secretsFor, roomJidFor });
  // T-0479: per-room round budgets (see RoomRound). In memory: a restart
  // safely resets it, a fresh start can only wake fewer AIs.
  const roomRounds = new Map<string, RoomRound>();
  // T-0475: the listener's per-room debounce windows and scoring calls.
  const roomListener = createRoomListener({
    deps,
    logger,
    baseUrl,
    secretsFor,
    sessions,
    roomRounds,
    sessionIsLive,
    pumpRoom: (session, roomJid) => pumpRoom(session, roomJid),
  });

  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribes: Array<() => void> = [];

  // T-0534 (plan §3, G5b): the session lifecycle lives in
  // `agents/gateway/sessions.ts`. The factory takes the shared maps and the
  // callbacks for the gateway code that stays here; the destructured names
  // keep every call site below unchanged.
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
    isStarted: () => started,
    handleIncoming: (session, message) => handleIncoming(session, message),
    dropRoomListenerIfUnused: (roomJid) => roomListener.dropRoomListenerIfUnused(roomJid),
  });

  function nowMs(): number {
    return (deps.now ?? (() => new Date()))().getTime();
  }

  function roomJidFor(roomLocalpart: string): string {
    return normBareJid(`${roomLocalpart}@${deps.xmpp.mucDomain}`);
  }

  function aiDeps(): AiServiceDeps {
    return {
      db: deps.db,
      adminClient: deps.adminClient,
      // Checked in `start`: both are present whenever a session runs.
      litellm: deps.litellm as LitellmAdminClient,
      cipher: deps.cipher as KeyCipher,
      logger,
      domain: deps.xmpp.domain,
    };
  }

  function secretsFor(virtualKey?: string): string[] {
    return [
      ...(virtualKey === undefined ? [] : [virtualKey]),
      ...(deps.masterKeyForRedaction === undefined ? [] : [deps.masterKeyForRedaction]),
    ];
  }

  // The budget gate owns the in-memory notice state, the daily-limit check,
  // the 80% warnings and the per-round gate, shared by the DM and group turns.
  const budgetGate = createBudgetGate({ deps, logger, sessionIsLive, secretsFor });

  const { loadMemoryContext, startCompaction } = createMemoryRunner({
    deps,
    logger,
    baseUrl,
    modelNameForAi,
    secretsFor,
    nowMs,
    toRedactedError,
    checkDmRoundGate: budgetGate.checkDmRoundGate,
  });

  // T-0556 (plan §3, G4): the tool executor lives in
  // `agents/gateway/tool-exec.ts`. This is a pure move: the factory takes
  // the shared session maps, the live session check and the gateway
  // callbacks the moved code closes over, and the destructured names keep
  // the turn factories' ctx fields unchanged. `createGroupIngest` below is
  // created after it because the `pumpRoom` callback reads lazily, while
  // `createDmTurn` and `createGroupTurn` are created after both so the
  // executor's functions are real values rather than lazy arrows.
  const { executeToolCall, withToolGuide } = createToolExec({
    deps,
    logger,
    sessions,
    roomRounds,
    sessionIsLive,
    pumpRoom: (session, roomJid) => pumpRoom(session, roomJid),
    secretsFor,
  });

  // T-0540 (plan §3, G7): the DM turn lives in `agents/gateway/dm-turn.ts`.
  // This is a pure move: the factory takes the live session, the budget gate,
  // the memory runner and the gateway callbacks the moved code closes over,
  // and the destructured name keeps `handleIncoming`'s call site unchanged.
  const { pumpSession } = createDmTurn({
    deps,
    logger,
    turnLogger,
    baseUrl,
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
    aiDeps,
    executeToolCall,
    withToolGuide,
    draftHub,
  });

  // T-0549 (plan §3, G8b): the group ingest side lives in
  // `agents/gateway/group-ingest.ts`. This is a pure move: the factory takes
  // the shared session maps, the room listener and the group turn runner, and
  // the destructured names keep every call site below unchanged. The
  // `runGroupSessionTurn` callback reads lazily: the group turn factory is
  // created just below.
  const { sessionForAiJid, handleRoomIncoming, pumpRoom } = createGroupIngest({
    deps,
    logger,
    sessions,
    roomRounds,
    noteListenerMessage: roomListener.noteListenerMessage,
    secretsFor,
    runGroupSessionTurn: (session, roomJid, batch) => runGroupSessionTurn(session, roomJid, batch),
  });

  // T-0546 (plan §3, G8a): the group/topic turn lives in
  // `agents/gateway/group-turn.ts`. This is a pure move: the factory takes
  // the shared session maps, the live session, the budget gate, the memory
  // runner and the gateway callbacks the moved code closes over, and the
  // destructured name keeps `pumpRoom`'s call site unchanged.
  const { runGroupSessionTurn } = createGroupTurn({
    deps,
    logger,
    turnLogger,
    baseUrl,
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
    aiDeps,
    executeToolCall,
    withToolGuide,
    nowMs,
  });

  async function reconcile(): Promise<void> {
    let active: ActiveAiForGateway[];
    try {
      active = await listActiveAisForGateway(deps.db);
    } catch (error) {
      logger.warn({ err: toRedactedError(error, secretsFor()) }, 'AI reconcile failed');
      return;
    }
    const wanted = new Set(active.map((ai) => ai.id));
    for (const ai of active) {
      try {
        const existing = sessions.get(ai.id);
        if (existing === undefined) {
          await connectAi(ai);
        } else {
          // Rooms drift without a reconnect: a missed group event, a failed
          // join, or a stale nick is picked up here at the latest.
          await syncAiRooms(existing, ai.name);
        }
      } catch (error) {
        logger.warn(
          { err: toRedactedError(error, secretsFor()), aiId: ai.id },
          'AI reconcile connect failed',
        );
      }
    }
    for (const aiId of sessions.keys()) {
      if (!wanted.has(aiId)) {
        try {
          await disconnectAi(aiId);
        } catch (error) {
          logger.warn(
            { err: toRedactedError(error, secretsFor()), aiId },
            'AI reconcile disconnect failed',
          );
        }
      }
    }
  }

  function handleIncoming(session: AiSession, message: ChatMessage): void {
    // An edit or a retraction of a message is never a new turn, in a DM or in a
    // room: the AI re-answering edits is out of scope. This is the first check,
    // before any routing, pairing, database or model work.
    if (message.correction !== undefined || message.retraction !== undefined) {
      return;
    }
    if (session.stopped || sessions.get(session.aiId) !== session) {
      return;
    }
    if (message.kind === 'groupchat') {
      handleRoomIncoming(session, message);
      return;
    }
    // v0 answers DMs only. Groups, own messages and empty bodies are ignored
    // before any database or model work.
    if (message.kind !== 'chat' || message.outgoing) {
      return;
    }
    const body = message.body?.trim() ?? '';
    if (body === '') {
      return;
    }
    session.pending.push({ id: message.id, body, fromJid: message.fromJid });
    // `busy` is reset in the pump's `finally`, but a truly unexpected throw
    // still needs a redacted log line rather than an unhandled rejection.
    void pumpSession(session).catch((error: unknown) => {
      logger.warn(
        { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
        'AI pump failed',
      );
    });
  }

  // (T-0549: `sessionForAiJid`, `handleRoomIncoming` and `pumpRoom` now live
  // in `agents/gateway/group-ingest.ts`; the destructured names above keep
  // every call site unchanged.)

  async function start(): Promise<void> {
    if (started) {
      return;
    }
    if (!config.enabled) {
      logger.info({}, 'agent gateway is disabled');
      return;
    }
    if (deps.litellm === undefined || deps.cipher === undefined) {
      logger.warn({}, 'agent gateway needs LiteLLM and the key cipher; staying off');
      return;
    }
    started = true;
    superseded.clear();
    await reconcile();
    unsubscribes.push(
      onAiLifecycle((event) => {
        if (!started) {
          return;
        }
        if (event.type === 'created' || event.type === 'resumed') {
          // `loadActiveAi` is the same `WHERE status = 'active'` filter the
          // periodic reconcile uses (T-0080): a `stopped` or `disabled` row
          // never wakes the gateway back up, even on the notifier path.
          void loadActiveAi(deps.db, event.aiId)
            .then((record) => {
              if (record !== null) {
                return connectAi(record);
              }
            })
            .catch((error: unknown) => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
                event.type === 'created'
                  ? 'AI post-create connect failed'
                  : 'AI post-resume connect failed',
              );
            });
        } else {
          // `stopped` and `deleted` both go through `disconnectAi`: the
          // session is removed from the map, `session.stopped` is set so
          // every send path skips, and queued turns are dropped with the
          // session. For `stopped` the periodic safety net never reconnects
          // (the row is no longer in `listActiveAisForGateway`); a delete
          // tears the row down on its own.
          void disconnectAi(event.aiId).catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              event.type === 'stopped'
                ? 'AI post-stop disconnect failed'
                : 'AI post-delete disconnect failed',
            );
          });
        }
      }),
      onGroupAi((event) => {
        if (!started) {
          return;
        }
        // A join or leave for a live session syncs right away; anything
        // missed (an AI with no session yet) is picked up by `reconcile`.
        // Only ids travel on the event.
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
      // T-0109: the sibling event for per-topic AI membership. A newly added
      // or removed membership shows up without waiting for the next full
      // reconcile, through the same right-away sync as the group event.
      onTopicAi((event) => {
        if (!started) {
          return;
        }
        const session = sessions.get(event.aiId);
        if (session === undefined) {
          return;
        }
        void loadActiveAi(deps.db, event.aiId)
          .then((record) => {
            if (record !== null && sessions.get(event.aiId) === session) {
              return syncAiRooms(session, record.name);
            }
          })
          .catch((error: unknown) => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: event.aiId },
              'AI room sync failed',
            );
          });
      }),
    );
    timer = setInterval(() => {
      if (started) {
        void reconcile();
      }
    }, reconcileIntervalMs);
  }

  async function stop(): Promise<void> {
    started = false;
    superseded.clear();
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        // Unsubscribing is best-effort during shutdown.
      }
    }
    unsubscribes = [];
    for (const aiId of sessions.keys()) {
      try {
        await disconnectAi(aiId);
      } catch {
        // Shutdown disconnects everyone; one failure stops nothing else.
      }
    }
    roomListener.clearAll();
  }

  return {
    start,
    stop,
    reconcile,
    size: () => sessions.size,
    aiIds: () => [...sessions.keys()],
    postToChat,
  };
}
