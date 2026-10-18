// The preview pass after a connect or resume: fills empty chat-list rows at a bounded
// concurrency, so one reconnect is not one unbounded MAM burst.
import { Effect } from 'effect';
import type { XmppCore } from '@zilar/xmpp-core';
import { loadPreview, type HistoryCtx } from './history';

export const PREVIEW_CONCURRENCY = 4;

/**
 * Loads the newest message of every chat that still needs it; a row that already carries
 * `lastMessage` and a known cursor is skipped. The rest run `PREVIEW_CONCURRENCY` at a
 * time.
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
