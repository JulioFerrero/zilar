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

interface LiveSessionContext {
  sessions: Map<string, AiSession>;
  deps: Pick<AgentGatewayDeps, 'db' | 'xmpp'>;
  logger: GatewayLogger;
  secretsFor: (virtualKey?: string) => string[];
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

  // T-0106: posts one live progress message for a multi-round turn and
  // updates it at each round (XMPP message correction, the same mechanism
  // streaming replies use). Stage texts come from the fixed table in
  // `agents/tool-guide.ts` — never model text, never tool output. Best
  // effort: a failed post or update warns with ids only and the turn
  // continues. Resolves with the progress message id when one was posted,
  // else null.
  function liveProgressReporter(
    session: AiSession,
    to: string,
    kind: ChatKind,
    aiJid: string,
  ): {
    reportProgress: (stage: string) => Promise<string | null>;
    clearProgress: () => Promise<void>;
  } {
    let progressId: string | null = null;

    // The sends are lifted with plain `Effect.promise`: a rejection dies with
    // the original error, and `catchDefect` logs it (ids only) like the old
    // `catch` blocks did.
    const reportProgressEffect = Effect.fnUntraced(function* (
      stage: string,
    ): Effect.fn.Return<string | null> {
      if (!sessionIsLive(session)) {
        return null;
      }
      const payload = { v: 0 as const, type: 'progress' as const, data: { ai: aiJid, stage } };
      return yield* Effect.gen(function* () {
        const current = progressId;
        if (current === null) {
          const sent = yield* Effect.promise(() =>
            session.core.sendMessage(to, kind, stage, { payload }),
          );
          progressId = sent.id === '' ? null : sent.id;
          return progressId;
        }
        yield* Effect.promise(() => session.core.sendCorrection(to, kind, current, stage));
        return progressId;
      }).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI progress message could not be sent',
            );
            return progressId;
          }),
        ),
      );
    });

    // The final text replaces the progress line: clients render the
    // newest message, and the progress card drops out of view. A
    // correction keeps one bubble instead of leaving a stale
    // "working on it" line next to the answer. Best effort like
    // every other progress send.
    const clearProgressEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
      const current = progressId;
      if (current === null || !sessionIsLive(session)) {
        return;
      }
      yield* Effect.promise(() => session.core.sendRetraction(to, kind, current)).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => {
            logger.warn(
              { err: toRedactedError(error, secretsFor()), aiId: session.aiId },
              'AI progress message could not be cleared',
            );
          }),
        ),
      );
      progressId = null;
    });

    return {
      reportProgress: (stage: string): Promise<string | null> =>
        Effect.runPromise(reportProgressEffect(stage)),
      clearProgress: (): Promise<void> => Effect.runPromise(clearProgressEffect()),
    };
  }

  function liveSendTyping(
    session: AiSession,
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
  ): void {
    if (!sessionIsLive(session)) {
      return;
    }
    session.core.sendTyping(to, kind, state);
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
    liveMarkDisplayed,
    postToChat,
  };
}
