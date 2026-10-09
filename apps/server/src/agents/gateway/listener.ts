import { Cause, Effect } from 'effect';
import type { ChatMessage } from '@zilar/xmpp-core';
import { normBareJid } from '../context';
import { completeChat } from '../reply';
import {
  LISTENER_WINDOW_MAX,
  loadRoster,
  scoreRoom,
  type ListenerWindowMessage,
} from '../listener/score';
import { loadGroupListenerSettings, loadTopicIsGeneral } from './db';
import {
  LISTENER_EVERY_N_DEFAULT,
  LISTENER_QUIET_MS_DEFAULT,
  attempt,
  cancelTimer,
  isAiSender,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomListenerState,
  type RoomRound,
  type RoomSubscription,
} from './contracts';

interface RoomListenerContext {
  deps: AgentGatewayDeps;
  logger: GatewayLogger;
  baseUrl: string;
  secretsFor: (virtualKey?: string) => string[];
  sessions: Map<string, AiSession>;
  roomRounds: Map<string, RoomRound>;
  sessionIsLive: (session: AiSession) => boolean;
  pumpRoom: (session: AiSession, roomJid: string) => Promise<void>;
}

export function createRoomListener(ctx: RoomListenerContext) {
  const { deps, logger, baseUrl, secretsFor, sessions, roomRounds, sessionIsLive, pumpRoom } = ctx;

  // T-0475: the listener's per-room debounce windows (see RoomListenerState).
  const roomListeners = new Map<string, RoomListenerState>();

  // T-0475: feed one human room message to the room's debounce window. Every
  // AI session receives the same stanza, so the first call records it and the
  // rest are dropped by id. A message that mentions an AI already wakes that
  // AI through the mention path, so it resets the window instead. Never logs
  // room text: ids and counts only.
  function noteListenerMessage(
    roomJid: string,
    room: RoomSubscription,
    message: ChatMessage,
    body: string,
  ): void {
    const listener = deps.listener;
    if (listener === undefined) {
      return;
    }
    const existing = roomListeners.get(roomJid);
    const state: RoomListenerState =
      existing ??
      (() => {
        const created: RoomListenerState = {
          groupId: room.groupId,
          topicId: room.topicId,
          window: [],
          seen: new Set(),
          count: 0,
          generation: 0,
          inFlight: false,
          timer: undefined,
        };
        roomListeners.set(roomJid, created);
        return created;
      })();
    if (state.seen.has(message.id)) {
      return;
    }
    state.seen.add(message.id);
    state.generation += 1;
    state.window.push({
      id: message.id,
      sender: message.fromNick ?? normBareJid(message.fromJid),
      text: body,
      fromJid: message.fromJid,
      fromResolved: message.fromResolved,
      ...(message.fromNick === undefined ? {} : { fromNick: message.fromNick }),
      timestamp: message.timestamp,
    });
    while (state.window.length > LISTENER_WINDOW_MAX) {
      const dropped = state.window.shift();
      if (dropped !== undefined) {
        state.seen.delete(dropped.id);
      }
    }
    const mentionsAi = (message.mentions ?? []).some((mention) =>
      isAiSender(normBareJid(mention.jid)),
    );
    if (mentionsAi) {
      // Mentions already wake the right AIs; drop the debounce.
      state.count = 0;
      clearListenerTimer(state);
      return;
    }
    state.count += 1;
    if (state.count >= (listener.everyN ?? LISTENER_EVERY_N_DEFAULT)) {
      clearListenerTimer(state);
      fireRoomListener(roomJid, state);
      return;
    }
    clearListenerTimer(state);
    // The debounce is a fiber that sleeps, then fires the check. It clears
    // the field first, so a later `clearListenerTimer` never touches it.
    state.timer = Effect.runFork(
      Effect.sleep(listener.quietMs ?? LISTENER_QUIET_MS_DEFAULT).pipe(
        Effect.andThen(
          Effect.sync(() => {
            state.timer = undefined;
            fireRoomListener(roomJid, state);
          }),
        ),
      ),
    );
  }

  function clearListenerTimer(state: RoomListenerState): void {
    cancelTimer(state.timer);
    state.timer = undefined;
  }

  // Starts the room's scoring call and does not wait for it: it logs its own
  // failures, so nothing is left to await.
  function fireRoomListener(roomJid: string, state: RoomListenerState): void {
    Effect.runFork(fireRoomListenerEffect(roomJid, state));
  }

  // One scoring call per room. Skips while a call is in flight and drops a
  // result whose window a newer human message replaced (plan §2.1).
  const fireRoomListenerEffect = Effect.fnUntraced(function* (
    roomJid: string,
    state: RoomListenerState,
  ): Effect.fn.Return<void> {
    const listener = deps.listener;
    if (listener === undefined || state.inFlight) {
      return;
    }
    state.inFlight = true;
    const generation = state.generation;
    const window: ListenerWindowMessage[] = state.window.map((entry) => ({
      id: entry.id,
      sender: entry.sender,
      text: entry.text,
    }));
    yield* Effect.gen(function* () {
      const group = yield* attempt(() => loadGroupListenerSettings(deps.db, state.groupId));
      if (group === null || !group.listenerEnabled) {
        return;
      }
      const isGeneralRow = yield* attempt(() => loadTopicIsGeneral(deps.db, state.topicId));
      // General rooms score the group's AIs; every other topic its own.
      const isGeneral = state.topicId === '' || isGeneralRow === true;
      const roster = yield* attempt(() =>
        loadRoster(
          deps.db,
          isGeneral
            ? { groupId: state.groupId }
            : { groupId: state.groupId, topicId: state.topicId },
        ),
      );
      const result = yield* attempt(() =>
        scoreRoom({
          complete: listener.complete ?? completeChat,
          baseUrl,
          virtualKey: listener.virtualKey,
          model: listener.model,
          roster,
          window,
          eagerness: group.listenerEagerness,
        }),
      );
      if (state.generation !== generation) {
        return;
      }
      if (result !== null) {
        wakeListenerAis(roomJid, state, result.wake);
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn(
            {
              err: toRedactedError(Cause.squash(cause), secretsFor(listener.virtualKey)),
              groupId: state.groupId,
            },
            'AI listener check failed',
          );
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          state.count = 0;
          state.inFlight = false;
        }),
      ),
    );
  });

  // Wakes each scored AI that still holds a live session in this room by
  // queueing the latest window message as a normal turn. The short "looking at
  // this" line is posted at turn time, once the turn passed every gate. The
  // turn-time checks (member, daily limit, rate limit, round budget) apply.
  function wakeListenerAis(
    roomJid: string,
    state: RoomListenerState,
    wakeIds: readonly string[],
  ): void {
    const latest = state.window[state.window.length - 1];
    if (latest === undefined) {
      return;
    }
    const woken: string[] = [];
    for (const aiId of wakeIds) {
      const session = sessions.get(aiId);
      if (session === undefined || !sessionIsLive(session)) {
        continue;
      }
      const room = session.rooms.get(roomJid);
      if (room === undefined) {
        continue;
      }
      const queued = session.roomPending.get(roomJid) ?? [];
      queued.push({
        id: latest.id,
        body: latest.text,
        fromJid: latest.fromJid,
        fromResolved: latest.fromResolved,
        ...(latest.fromNick === undefined ? {} : { fromNick: latest.fromNick }),
        timestamp: latest.timestamp,
        wake: true,
      });
      session.roomPending.set(roomJid, queued);
      Effect.runFork(
        attempt(() => pumpRoom(session, roomJid)).pipe(
          Effect.catch((error: unknown) =>
            Effect.sync(() => {
              logger.warn(
                { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
                'AI listener pump failed',
              );
            }),
          ),
        ),
      );
      woken.push(aiId);
    }
    if (woken.length > 0) {
      logger.info(
        { roomJid, groupId: state.groupId, aiIds: woken, count: state.count },
        'AI listener woke AIs',
      );
    }
  }

  // Drops a room's listener state once no live session is joined to it.
  function dropRoomListenerIfUnused(roomJid: string): void {
    for (const session of sessions.values()) {
      if (session.rooms.has(roomJid)) {
        return;
      }
    }
    const state = roomListeners.get(roomJid);
    if (state !== undefined) {
      clearListenerTimer(state);
    }
    roomListeners.delete(roomJid);
    roomRounds.delete(roomJid);
  }

  // Clears every pending debounce at shutdown.
  function clearAll(): void {
    for (const state of roomListeners.values()) {
      clearListenerTimer(state);
    }
    roomListeners.clear();
  }

  return { noteListenerMessage, dropRoomListenerIfUnused, clearAll };
}
