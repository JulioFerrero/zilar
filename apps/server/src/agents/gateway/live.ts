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

  // Whether a session is still owned by the gateway. T-0080: every send path
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

  // T-1414: one task card per turn — a `progress` message posted once, then
  // edited in place with corrections that carry the full payload. Stage texts
  // come from the fixed table in `agents/tool-guide.ts` — never model text,
  // never tool output. Corrections are throttled to at most one per second, so
  // a fast turn writes few MAM rows; the final correction always goes out with
  // `state`, `elapsed_ms` and `summary`. Nothing is retracted: the card stays
  // above the reply. Best effort: a failed post or update warns with ids only
  // and the turn continues.
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

    // The sends are lifted with plain `Effect.promise`: a rejection dies with
    // the original error, and `catchDefect` logs it (ids only) like the old
    // `catch` blocks did.
    const reportProgressEffect = Effect.fnUntraced(function* (
      stage: string,
      title?: string,
    ): Effect.fn.Return<string | null> {
      if (!sessionIsLive(session)) {
        return null;
      }
      // T-1406: the same fixed stage text rides the chat state, next to the
      // card. Both come from one place, so they never disagree.
      liveSendStatus(session, to, kind, stage);
      // T-1426: one session-log status row per reported stage. The label is a
      // fixed `TOOL_STAGE_*` text, never model or tool output.
      log?.append('status', { stage });
      const opened =
        card === null
          ? startTaskCard(stage, new Date().toISOString())
          : addTaskCardStep(card, stage);
      // T-1745: the model may name the card on its first call. The name is set
      // once; the fixed stage the card opened with becomes its first step.
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
      // T-1505: one session-log row records that the card was closed and how,
      // so the topic activity read model can tell a card that finished `done`
      // from one that failed or was stopped. A turn with no card logs nothing.
      log?.append('status', { stage: `card_${state}` });
      const elapsedMs = Math.max(0, Date.now() - Date.parse(card.startedAt));
      const finished = finishTaskCard(
        card,
        state,
        taskCardSummary({ state, elapsedMs, stepCount: card.steps.length }),
      );
      const payload = taskCardPayload({
        ai: aiJid,
        ...(taskId === undefined ? {} : { taskId }),
        card: finished,
        elapsedMs,
      });
      yield* Effect.promise(() =>
        session.core.sendCorrection(to, kind, current, finished.stage, { payload }),
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

  // T-1406: the AI's chat state carries its short fixed status text ("Thinking",
  // a `TOOL_STAGE_*` line). It goes out as a composing state, so it clears with
  // the `paused` the turn sends at the end and leaves nothing in history.
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

  // Looks up the room JID (bare) for one group. Returns `null` when the
  // group does not exist; the caller answers `false` for that case too.
  const loadRoomJid = Effect.fnUntraced(function* (
    groupId: string,
  ): Effect.fn.Return<string | null> {
    const roomLocalpart = yield* Effect.promise(() => loadGroupRoomLocalpart(deps.db, groupId));
    if (roomLocalpart === null) {
      return null;
    }
    return roomJidFor(roomLocalpart);
  });

  // Looks up the room JID (bare) for one topic. Returns `null` when the
  // topic does not exist or is archived; the caller answers `false` for
  // those cases too.
  const loadTopicRoomJid = Effect.fnUntraced(function* (
    topicId: string,
  ): Effect.fn.Return<string | null> {
    const row = yield* Effect.promise(() => loadTopicRoomRow(deps.db, topicId));
    if (row === null || row.archivedAt !== null) {
      return null;
    }
    return roomJidFor(row.roomLocalpart);
  });

  // Builds the `SendMessageOptions` for one `postToChat` call. The
  // `payload` field is only present when the caller actually passed one.
  function sendOptions(input: { text: string; payload?: Payload }): SendMessageOptions {
    return input.payload === undefined ? {} : { payload: input.payload };
  }

  // T-0092: posts one message from the AI's live XMPP session into the chat
  // the action gateway asked about. The session must be live (not stopped,
  // still owned by this gateway), the AI must exist, and — for a group —
  // the session must currently hold a subscription to the room. Any other
  // answer is `false` with no send, so a stopped AI (kill switch) and an
  // AI that was never in the room stay silent. T-0109: an optional `topicId`
  // posts into that topic's room instead (the AI must be a member and the
  // topic live); otherwise the group post goes into General (the group's own
  // room) or the DM. `session.rooms.has(roomJid)` remains the guard.
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

  return {
    sessionIsLive,
    liveSendMessage,
    liveProgressReporter,
    liveSendTyping,
    liveSendStatus,
    liveMarkDisplayed,
    postToChat,
    // T-1647: the routine runner resolves the owner JID and the room JID the
    // same way `postToChatEffect` does, so it needs the same loaders.
    loadOwnerId,
    loadRoomJid,
    loadTopicRoomJid,
  };
}
