// The topic list follows AI activity live: a card that starts, ends or waits on a task
// means the server's view changed, so refresh the list a few seconds later, once per burst.
// A client only receives room messages for rooms it may read, so this reveals nothing new.
import type { ChatMessage } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import type { CoreCtx, StoreAppHooks } from './ctx';

/** How long a refresh waits: a turn's start and its first steps cost one fetch. */
export const ACTIVITY_REFRESH_DELAY_MS = 3000;

const ACTIVITY_REFRESH_KEY = 'ai-activity-refresh';

/**
 * The live group messages whose card changes a topic's AI activity: a new `progress`
 * card (a turn started), its terminal correction, an `approval.request` or a `question`.
 */
export function isAiActivityMessage(message: ChatMessage): boolean {
  if (message.kind !== 'groupchat') {
    return false;
  }
  const payload = message.payload;
  if (payload === undefined) {
    return false;
  }
  if (payload.type === 'progress') {
    const state = payload.data.state;
    return (
      message.correction === undefined ||
      state === 'done' ||
      state === 'failed' ||
      state === 'stopped'
    );
  }
  return (
    (payload.type === 'approval.request' || payload.type === 'question') &&
    message.correction === undefined
  );
}

/**
 * Refreshes the chat list once, `ACTIVITY_REFRESH_DELAY_MS` after the first activity of a
 * burst; the timer is a keyed store fiber, so it dies with `stop()`.
 */
export function scheduleActivityRefresh(ctx: CoreCtx): void {
  if (ctx.rt.has(ACTIVITY_REFRESH_KEY)) {
    return;
  }
  // `CoreCtx` narrows `fx` to `CoreHooks`; both apps pass the full `StoreAppHooks`, which
  // carries the chat-list refresh this needs.
  const { scheduleChatsRefresh } = ctx.fx as StoreAppHooks;
  ctx.rt.forkKeyed(
    ACTIVITY_REFRESH_KEY,
    Effect.sleep(ACTIVITY_REFRESH_DELAY_MS).pipe(
      Effect.andThen(Effect.sync(() => scheduleChatsRefresh())),
    ),
  );
}
