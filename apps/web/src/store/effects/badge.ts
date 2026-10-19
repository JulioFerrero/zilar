// Badge and push dismissal are best effort: a failure never reaches the caller, and neither
// waits on the store scope, so a sync started before stop() still finishes.
import { Effect } from 'effect';
import { totalBadgeUnread, updateAppBadge } from '@/lib/push';
import type { StoreCtx } from './ctx';
import { fromPromise } from './util';

// Total unread excluding muted chats, mirrored to the app badge where supported.
const syncBadge = (ctx: StoreCtx): Effect.Effect<void> =>
  Effect.suspend(() => fromPromise(() => updateAppBadge(totalBadgeUnread(ctx.get().chats)))).pipe(
    Effect.ignore,
  );

export const syncBadgeInBackground = (ctx: StoreCtx): void => {
  ctx.rt.runDetached(syncBadge(ctx));
};
