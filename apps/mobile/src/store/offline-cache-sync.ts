import type { StoreApi } from '@zilar/client-core';
import {
  buildCacheSnapshot,
  createMessageCacheWriter,
  type MessageCacheWriter,
} from '@zilar/client-core/store';
import { getActiveChatId } from '../lib/push/active-chat';
import {
  MAX_CACHED_CHATS,
  OFFLINE_CACHE_WRITE_DELAY_MS,
  defaultOfflineCachePort,
  encodeOfflineCache,
  readSessionUserId,
  type OfflineCachePort,
} from './offline-cache';
import type { ChatStoreState } from './types';

export interface OfflineCacheSync {
  readonly cache: MessageCacheWriter;
  readonly sessionUserId: () => Promise<string | undefined>;
  watch(store: Pick<StoreApi<ChatStoreState>, 'subscribe' | 'getState'>): void;
}

export function createOfflineCacheSync(deps: {
  offlineCache?: OfflineCachePort;
  sessionUserId?: () => Promise<string | undefined>;
}): OfflineCacheSync {
  const cache = createMessageCacheWriter(deps.offlineCache ?? defaultOfflineCachePort(), {
    delayMs: OFFLINE_CACHE_WRITE_DELAY_MS,
    encode: encodeOfflineCache,
  });
  return {
    cache,
    sessionUserId: deps.sessionUserId ?? readSessionUserId,
    watch(store) {
      // Before a user is signed in, the snapshot is undefined and nothing is written, so no bare list is persisted.
      store.subscribe(() => {
        const state = store.getState();
        const snapshot = buildCacheSnapshot({
          userId: state.me?.id,
          chats: state.chats,
          messagesByChat: state.messagesByChat,
          activeChatId: getActiveChatId(),
          maxChats: MAX_CACHED_CHATS,
          pinsFor: (chatId) => state.pins(chatId),
        });
        if (snapshot !== undefined) {
          cache.schedule(snapshot);
        }
      });
    },
  };
}
