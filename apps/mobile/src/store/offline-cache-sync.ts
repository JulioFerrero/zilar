/**
 * The store side of the offline message cache (T-1313): builds the cache from
 * the injected file port and the signed-in-user reader, and watches the store,
 * scheduling a debounced save. `real-store.ts` wires it in with two lines; the
 * cache itself lives in `offline-cache.ts` and the hydrate/flush/clear hooks in
 * `effects/lifecycle.ts`.
 */
import type { StoreApi } from './atomStore';
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
  /** The cache the lifecycle hydrates and clears. */
  readonly cache: OfflineCache;
  /** Reads the signed-in user id for the owner check. */
  readonly sessionUserId: () => Promise<string | undefined>;
  /** Schedules a debounced save on every store change while a user is signed in. */
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
      // Before a user is signed in `offlineSnapshot` returns undefined and
      // nothing is written, so hydration and the sign-in boot never persist a
      // bare list.
      store.subscribe(() => {
        const state = store.getState();
        const snapshot = offlineSnapshot(
          state.me?.id,
          state.chats,
          state.messagesByChat,
          getActiveChatId(),
        );
        if (snapshot !== undefined) {
          cache.schedule(snapshot);
        }
      });
    },
  };
}
