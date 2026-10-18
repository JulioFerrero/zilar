// What the store remembers between visits: the painted chat list and the last read message of
// each chat. Both are best effort; a full or blocked storage must never break messaging.
import { writeChatListCache } from '../chatListCache';
import { syncBadgeInBackground } from './badge';
import type { StoreCtx } from './ctx';

export { persistLastRead, recordRead } from '@zilar/client-core/store';

export function saveChatList(ctx: StoreCtx): void {
  const state = ctx.get();
  if (state.chatsState === 'ready') {
    writeChatListCache(ctx.ports.storage, state.currentUserId, state.chats);
    // Every painted-list change re-syncs the badge (a mute changes the total too).
    syncBadgeInBackground(ctx);
  }
}
