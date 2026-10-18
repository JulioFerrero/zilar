import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';

import type { Me } from '../lib/auth-api';

/**
 * Where the bearer session token and the last profile are persisted between
 * launches; the profile sits beside the token so a cold start opens the chats
 * while the server is unreachable.
 */
export interface SessionStorage {
  getToken(): Promise<string | undefined>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  getMe(): Promise<Me | undefined>;
  setMe(me: Me): Promise<void>;
}

/** In-memory storage for tests only. */
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
