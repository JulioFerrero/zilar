// The preview pass after a connect or a resume: fills the chat-list rows the
// server's chat list left empty, at a bounded concurrency so one reconnect is
// not one unbounded MAM burst (PERF-1).
import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { loadPreview, type HistoryCtx } from './history';

/** How many chat previews load at once after a (re)connect. */
export const PREVIEW_CONCURRENCY = 4;

/**
 * Loads the newest message of every chat that still needs it. A chat whose
 * list row already carries a `lastMessage` and whose cursor is known is
 * skipped: the server's chat list (T-1198) sent its preview. The rest run
 * `PREVIEW_CONCURRENCY` at a time.
 */
export const loadPreviews = (ctx: HistoryCtx, current: XmppCore): Effect.Effect<void> =>
  Effect.suspend(() =>
    Effect.all(
      ctx
        .get()
        .chats.filter(
          (chat) => chat.lastMessage === undefined || ctx.cursors[chat.id] === undefined,
        )
        .map((chat) => loadPreview(ctx, current, chat)),
      { concurrency: PREVIEW_CONCURRENCY },
    ).pipe(Effect.asVoid),
  );
