import { Effect } from 'effect';
import { fromApi, makeBlockedJidsStore } from '@zilar/client-core';

import { listBlockedUsers } from './api';

const store = makeBlockedJidsStore({
  load: () => Effect.runPromise(fromApi(() => listBlockedUsers())),
  watchRefresh: (refresh) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('focus', () => {
      void refresh();
    });
  },
});

/** The lowercased localparts I blocked; starts loading on first use. */
export const useBlockedJids = store.useBlockedJids;

export const refreshBlockedJids = store.refresh;

/** Test-only: reset the module state between tests. */
export const resetBlockedJidsForTests = store.resetForTests;
