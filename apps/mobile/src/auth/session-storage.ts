import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';

import type { Me } from '../lib/auth-api';

/**
 * Where the bearer session token and the last profile are persisted between
 * app launches. The profile sits beside the token so a cold start can open the
 * app on the chats while the server is unreachable (T-1304).
 */
export interface SessionStorage {
  getToken(): Promise<string | undefined>;
  setToken(token: string): Promise<void>;
  /** Clears the token and the cached profile together (sign-out, 401). */
  clearToken(): Promise<void>;
  getMe(): Promise<Me | undefined>;
  setMe(me: Me): Promise<void>;
}

/** In-memory storage for tests; never used by the app. */
export function createMemorySessionStorage(initial?: string): SessionStorage {
  let token: string | undefined = initial;
  let me: Me | undefined;
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
          me = undefined;
        }),
      ),
    getMe: () => runMobile(Effect.sync(() => me)),
    setMe: (next) =>
      runMobile(
        Effect.sync(() => {
          me = next;
        }),
      ),
  };
}
