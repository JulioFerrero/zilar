import type { StoreApi } from '@zilar/client-core';
import { getActiveChatId } from '../lib/push/active-chat';
import {
  createOfflineCache,
  defaultOfflineCachePort,
  offlineSnapshot,
  readSessionUserId,
  type OfflineCache,
  type OfflineCachePort,
} from './offline-cache';
import type { ChatStoreState } from './types';

export interface OfflineCacheSync {
  readonly cache: OfflineCache;
  readonly sessionUserId: () => Promise<string | undefined>;
  watch(store: Pick<StoreApi<ChatStoreState>, 'subscribe' | 'getState'>): void;
}

export function createOfflineCacheSync(deps: {
  offlineCache?: OfflineCachePort;
  sessionUserId?: () => Promise<string | undefined>;
}): OfflineCacheSync {
  const cache = createOfflineCache(deps.offlineCache ?? defaultOfflineCachePort());
  return {
    cache,
    sessionUserId: deps.sessionUserId ?? readSessionUserId,
    watch(store) {
      // Before a user is signed in, `offlineSnapshot` returns undefined and nothing is written, so no bare list is persisted.
      store.subscribe(() => {
        const state = store.getState();
        const snapshot = offlineSnapshot(
          state.me?.id,
          state.chats,
          state.messagesByChat,
          getActiveChatId(),
          (chatId) => state.pins(chatId),
        );
        if (snapshot !== undefined) {
          cache.schedule(snapshot);
        }
      });
    },
  };
}
