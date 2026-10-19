/**
 * `expo-secure-store` is imported dynamically so this module loads under Vitest (Node), which cannot import the native module.
 */

import { Effect } from 'effect';

export const PUSH_LAST_RECEIVED_KEY = 'zilar.push.lastReceived';

export function secureStore(): Promise<typeof import('expo-secure-store')> {
  return import('expo-secure-store');
}

/** Records the receipt time, best effort: a storage failure never breaks a wake. */
export function recordPushReceived(at: Date = new Date()): Promise<void> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const store = await secureStore();
        await store.setItemAsync(PUSH_LAST_RECEIVED_KEY, at.toISOString());
      },
      catch: (error) => error,
    }).pipe(Effect.ignore),
  );
}

export function readLastPushReceived(): Promise<string | null> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const store = await secureStore();
        return await store.getItemAsync(PUSH_LAST_RECEIVED_KEY);
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null)),
  );
}
