// The installed app's badge and the chat's push notifications. Both are best
// effort: a failure never reaches the caller, and neither waits on the store
// Scope, so a badge sync that was started before `stop()` still finishes.
import { Effect } from 'effect';
import { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from '@/lib/push';
import type { StoreCtx } from './ctx';
import { fromPromise } from './util';

// Total unread excluding muted chats, mirrored to the installed app's badge
// where the platform supports it. The total is read when the effect runs.
const syncBadge = (ctx: StoreCtx): Effect.Effect<void> =>
  Effect.suspend(() => fromPromise(() => updateAppBadge(totalBadgeUnread(ctx.get().chats)))).pipe(
    Effect.ignore,
  );

/** Starts a badge sync without waiting for it. */
export const syncBadgeInBackground = (ctx: StoreCtx): void => {
  ctx.rt.runDetached(syncBadge(ctx));
};

/** Dismisses the chat's push notifications without waiting for it. */
export const dismissNotificationsInBackground = (ctx: StoreCtx, chatId: string): void => {
  ctx.rt.runDetached(fromPromise(() => dismissChatNotifications(chatId)).pipe(Effect.ignore));
};
