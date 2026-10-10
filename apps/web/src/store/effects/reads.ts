// What the store remembers between visits: the painted chat list and the last
// message read in each chat (`@zilar/client-core/store`). Both are best effort;
// a full or blocked storage must never break messaging.
import { writeChatListCache } from '../chatListCache';
import { syncBadgeInBackground } from './badge';
import type { StoreCtx } from './ctx';

export { persistLastRead, recordRead } from '@zilar/client-core/store';

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
