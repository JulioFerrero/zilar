// The last message read in each chat. The map is saved per user when the store
// has storage; saving is best effort, so a full or blocked storage must never
// break messaging.
import { Effect } from 'effect';
import type { CoreCtx } from './ctx';

/** The storage key prefix of a user's last-read map. */
export const LAST_READ_PREFIX = 'zilar:lastRead:';

/** Saves the last-read map of the current user. */
export function persistLastRead(ctx: CoreCtx): void {
  const storage = ctx.ports.storage;
  const userId = ctx.lastReadUserId;
  if (storage === null || userId === undefined) {
    return;
  }
  Effect.runSync(
    Effect.try(() =>
      storage.setItem(`${LAST_READ_PREFIX}${userId}`, JSON.stringify(ctx.lastRead)),
    ).pipe(Effect.ignore),
  );
}

/** Marks a chat as read up to `messageId`, clears its unread count and its notifications. */
export function recordRead(ctx: CoreCtx, chatId: string, messageId: string | undefined): void {
  if (messageId !== undefined) {
    ctx.lastRead[chatId] = messageId;
    persistLastRead(ctx);
  }
  ctx.set((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
    ),
  }));
  // The chat is read in the app: its push notifications go away and the app
  // badge drops. Both are best effort.
  ctx.fx.dismissChatNotifications(chatId);
  ctx.fx.syncBadge();
}
