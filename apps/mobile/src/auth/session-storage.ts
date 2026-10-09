import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';

/** Where the bearer session token is persisted between app launches. */
export interface SessionStorage {
  getToken(): Promise<string | undefined>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

/** In-memory storage for tests; never used by the app. */
export function createMemorySessionStorage(initial?: string): SessionStorage {
  let token: string | undefined = initial;
  return {
    getToken: () => runMobile(Effect.sync(() => token)),
    setToken: (next) =>
      runMobile(
        Effect.sync(() => {
          token = next;
        }),
      ),
    clearToken: () =>
      runMobile(
        Effect.sync(() => {
          token = undefined;
        }),
      ),
  };
}
