import { Effect } from 'effect';
import type { ChatKind, SendMessageOptions } from '@zilar/xmpp-core';
import type { Payload } from '@zilar/protocol';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { loadAiOwnerId, loadGroupRoomLocalpart, loadTopicRoomRow } from './db';
import {
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
} from './contracts';
import {
  addTaskCardStep,
  finishTaskCard,
  nameTaskCard,
  startTaskCard,
  taskCardPayload,
  taskCardSummary,
  type TaskCard,
} from '../task-card';
import type { TurnLog } from '../log/append';

interface LiveSessionContext {
  sessions: Map<string, AiSession>;
  deps: Pick<AgentGatewayDeps, 'db' | 'xmpp'>;
  logger: GatewayLogger;
  secretsFor: (secret?: string) => string[];
  roomJidFor: (roomLocalpart: string) => string;
}

export function createLiveSession(ctx: LiveSessionContext) {
  const { sessions, deps, logger, secretsFor, roomJidFor } = ctx;

  // Whether a session is still owned by the gateway. Every send path
  // a running AI turn triggers — DM reply, group reply, budget warnings,
  // daily-limit notice, drafts, persona-tool notice — checks this right
  // before it sends, so a stop that lands mid-turn drops the reply rather
  // than delivering it. `disconnectAi` flips `stopped` to `true` and removes
  // the session from the map; both checks together cover the race.
  function sessionIsLive(session: AiSession): boolean {
    return !session.stopped && sessions.get(session.aiId) === session;
  }

  // Wraps `core.sendMessage` so any send during a turn is skipped the moment
  // the AI is stopped. The skip resolves with an empty id, which matches
  // what `sendMessage` returns for a successful send — the caller still
  // sees a successful path, only the wire never carries the text.
  function liveSendMessageEffect(
    session: AiSession,
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Effect.Effect<{ id: string }> {
    if (!sessionIsLive(session)) {
      return Effect.succeed({ id: '' });
    }
    return Effect.promise(() => session.core.sendMessage(to, kind, text, opts));
  }

  function liveSendMessage(
    session: AiSession,
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<{ id: string }> {
    return Effect.runPromise(liveSendMessageEffect(session, to, kind, text, opts));
  }

  // One task card per turn: a `progress` message posted once and edited in
  // place, at most one correction per second. Stage texts are fixed, never model
  // or tool text; nothing is retracted, so the card stays above the reply. Best
  // effort: a failed post or update warns with ids only and the turn continues.
  const PROGRESS_THROTTLE_MS = 1_000;

  function liveProgressReporter(
    session: AiSession,
    to: string,
    kind: ChatKind,
    aiJid: string,
    log?: TurnLog,
  ): {
    reportProgress: (stage: string, title?: string) => Promise<string | null>;
    finishProgress: (state: 'done' | 'failed' | 'stopped') => Promise<void>;
  } {
    const taskId = log?.taskId;
    let progressId: string | null = null;
    let card: TaskCard | null = null;
    let lastSentAtMs = 0;

    const reportProgressEffect = Effect.fnUntraced(function* (
      stage: string,
      title?: string,
    ): Effect.fn.Return<string | null> {
      if (!sessionIsLive(session)) {
        return null;
      }
      // The same fixed stage text rides the chat state, next to the card, so
      // they never disagree.
      liveSendStatus(session, to, kind, stage);
      // One session-log status row per reported stage. The label is a fixed
      // `TOOL_STAGE_*` text, never model or tool output.
      log?.append('status', { stage });
      const opened =
        card === null
          ? startTaskCard(stage, new Date().toISOString())
          : addTaskCardStep(card, stage);
      // The model may name the card on its first call; the name is set once and
      // the fixed stage the card opened with becomes its first step.
      const nextCard = title === undefined ? opened : nameTaskCard(opened, title);
      card = nextCard;
      // Every correction carries the full payload, so a throttled update is
      // never lost: the next one (or the final one) brings it along.
      if (progressId !== null && Date.now() - lastSentAtMs < PROGRESS_THROTTLE_MS) {
        return progressId;
      }
      const payload = taskCardPayload({
        ai: aiJid,
        ...(taskId === undefined ? {} : { taskId }),
        card: nextCard,
      });
      return yield* Effect.gen(function* () {
        const current = progressId;
        if (current === null) {
          const sent = yield* Effect.promise(() =>
            session.core.sendMessage(to, kind, stage, { payload }),
          );
          progressId = sent.id === '' ? null : sent.id;
        } else {
          yield* Effect.promise(() =>
            session.core.sendCorrection(to, kind, current, stage, { payload }),
          );
        }
        lastSentAtMs = Date.now();
        return progressId;
      }).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI task card could not be updated',
            );
            return progressId;
          }),
        ),
      );
    });

    // The last correction closes the card: the terminal `state`, the elapsed
    // time and the fixed summary. The card stays in place (never retracted);
    // the reply lands below it. Best effort like every other card send.
    const finishProgressEffect = Effect.fnUntraced(function* (
      state: 'done' | 'failed' | 'stopped',
    ): Effect.fn.Return<void> {
      const current = progressId;
      if (current === null || card === null || !sessionIsLive(session)) {
        return;
      }
      // One session-log row records that the card was closed and how, so the
      // topic activity model can tell `done` from failed or stopped. A turn with
      // no card logs nothing.
      log?.append('status', { stage: `card_${state}` });
      const elapsedMs = Math.max(0, Date.now() - Date.parse(card.startedAt));
      const summary = taskCardSummary({ state, elapsedMs, stepCount: card.steps.length });
      const finished = finishTaskCard(card, state, summary);
      const payload = taskCardPayload({
        ai: aiJid,
        ...(taskId === undefined ? {} : { taskId }),
        card: finished,
        elapsedMs,
      });
      yield* Effect.promise(() =>
        session.core.sendCorrection(to, kind, current, summary, { payload }),
      ).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI task card could not be finished',
            );
          }),
        ),
      );
    });

    return {
      reportProgress: (stage: string, title?: string): Promise<string | null> =>
        Effect.runPromise(reportProgressEffect(stage, title)),
      finishProgress: (state: 'done' | 'failed' | 'stopped'): Promise<void> =>
        Effect.runPromise(finishProgressEffect(state)),
    };
  }

  function liveSendTyping(
    session: AiSession,
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
    status?: string,
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.sendTyping(to, kind, state, status);
  }

  // The AI's chat state carries its short fixed status text. It goes out as a
  // composing state, so it clears with the `paused` the turn sends at the end
  // and leaves nothing in history.
  function liveSendStatus(session: AiSession, to: string, kind: ChatKind, status: string): void {
    liveSendTyping(session, to, kind, 'composing', status);
  }

  function liveMarkDisplayed(
    session: AiSession,
    chatJid: string,
    kind: ChatKind,
    messageId: string,
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.markDisplayed(chatJid, kind, messageId);
  }

  // Looks up the AI's owner id from the database. The owner JID is derived
  // the same way the rest of the platform derives it (via `localpartFor` and
  // `jidFor`), so a DM announcement lands where the gateway already talks.
  const loadOwnerId = (aiId: string): Effect.Effect<string | null> =>
    Effect.promise(() => loadAiOwnerId(deps.db, aiId));

  const loadRoomJid = Effect.fnUntraced(function* (
    groupId: string,
  ): Effect.fn.Return<string | null> {
    const roomLocalpart = yield* Effect.promise(() => loadGroupRoomLocalpart(deps.db, groupId));
    if (roomLocalpart === null) {
      return null;
    }
    return roomJidFor(roomLocalpart);
  });

  const loadTopicRoomJid = Effect.fnUntraced(function* (
    topicId: string,
  ): Effect.fn.Return<string | null> {
    const row = yield* Effect.promise(() => loadTopicRoomRow(deps.db, topicId));
    if (row === null || row.archivedAt !== null) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  });

  function sendOptions(input: { text: string; payload?: Payload }): SendMessageOptions {
    return input.payload === undefined ? {} : { payload: input.payload };
  }

  // Posts one message from the AI's live session into the chat the action
  // gateway asked about. The session must be live (not stopped, still owned by
  // this gateway), the AI must exist, and for a group it must hold the room.
  // Anything else is `false` with no send, so a stopped AI and one that was
  // never in the room stay silent. An optional `topicId` posts into that topic's
  // room instead, otherwise into General or the DM.
  const postToChatEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }): Effect.fn.Return<boolean> {
    const session = sessions.get(input.aiId);
    if (session === undefined || !sessionIsLive(session)) {
      return false;
    }
    if (input.groupId === null) {
      const ownerId = yield* loadOwnerId(input.aiId);
      if (ownerId === null) {
        return false;
      }
      const ownerJid = jidFor(localpartFor(ownerId), deps.xmpp.domain);
      yield* liveSendMessageEffect(session, ownerJid, 'chat', input.text, sendOptions(input));
      return true;
    }
    if (input.topicId !== undefined) {
      const topicJid = yield* loadTopicRoomJid(input.topicId);
      if (topicJid === null) {
        return false;
      }
      if (!session.rooms.has(topicJid)) {
        return false;
      }
      yield* liveSendMessageEffect(session, topicJid, 'groupchat', input.text, sendOptions(input));
      return true;
    }
    const roomJid = yield* loadRoomJid(input.groupId);
    if (roomJid === null) {
      return false;
    }
    if (!session.rooms.has(roomJid)) {
      return false;
    }
    yield* liveSendMessageEffect(session, roomJid, 'groupchat', input.text, sendOptions(input));
    return true;
  });

  function postToChat(input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }): Promise<boolean> {
    return Effect.runPromise(postToChatEffect(input));
  }

  // Corrects one message the AI posted in a room (XEP-0308) with the same
  // guards as `postToChatEffect`. A DM card corrects as `chat`.
  const correctInRoomEffect = Effect.fnUntraced(function* (input: {
    aiId: string;
    roomJid: string;
    originalId: string;
    text: string;
    payload?: Payload;
  }): Effect.fn.Return<boolean> {
    const session = sessions.get(input.aiId);
    if (session === undefined || !sessionIsLive(session)) {
      return false;
    }
    const isRoom = session.rooms.has(input.roomJid);
    if (!isRoom) {
      const ownerId = yield* loadOwnerId(input.aiId);
      if (ownerId === null) {
        return false;
      }
      const ownerJid = jidFor(localpartFor(ownerId), deps.xmpp.domain);
      if (ownerJid.toLowerCase() !== input.roomJid.toLowerCase()) {
        return false;
      }
    }
    yield* Effect.promise(() =>
      session.core.sendCorrection(
        input.roomJid,
        isRoom ? 'groupchat' : 'chat',
        input.originalId,
        input.text,
        sendOptions(input),
      ),
    );
    return true;
  });

  function correctInRoom(input: {
    aiId: string;
    roomJid: string;
    originalId: string;
    text: string;
    payload?: Payload;
  }): Promise<boolean> {
    return Effect.runPromise(correctInRoomEffect(input));
  }

  return {
    sessionIsLive,
    liveSendMessage,
    liveProgressReporter,
    liveSendTyping,
    liveSendStatus,
    liveMarkDisplayed,
    postToChat,
    // Correct a card in the room as the AI, after a member answers it.
    correctInRoom,
    loadOwnerId,
    loadRoomJid,
    loadTopicRoomJid,
  };
}
