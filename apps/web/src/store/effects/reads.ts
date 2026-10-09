// What the store remembers between visits: the painted chat list and the last
// message read in each chat. Both are best effort; a full or blocked storage
// must never break messaging.
import { Effect } from 'effect';
import { writeChatListCache } from '../chatListCache';
import { dismissNotificationsInBackground, syncBadgeInBackground } from './badge';
import { LAST_READ_PREFIX } from './constants';
import type { StoreCtx } from './ctx';

/** Saves the painted list for the next visit and re-syncs the app badge. */
export function saveChatList(ctx: StoreCtx): void {
  const state = ctx.get();
  if (state.chatsState === 'ready') {
    writeChatListCache(ctx.ports.storage, state.currentUserId, state.chats);
    // Every painted-list change re-syncs the badge (mute changes the total
    // too, not just unread bumps).
    syncBadgeInBackground(ctx);
  }
}

/** Saves the last-read map of the current user. */
export function persistLastRead(ctx: StoreCtx): void {
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
export function recordRead(ctx: StoreCtx, chatId: string, messageId: string | undefined): void {
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
  dismissNotificationsInBackground(ctx, chatId);
  syncBadgeInBackground(ctx);
}
