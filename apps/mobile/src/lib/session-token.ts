import { Effect } from 'effect';

/**
 * Reads the persisted bearer session token for the chat API calls. The
 * `expo-secure-store` import is dynamic so this module can be loaded under
 * Vitest (Node), which cannot import the native module.
 */
const sessionTokenEffect = (): Effect.Effect<string | undefined> =>
  Effect.promise(() => import('../auth/secure-session-storage')).pipe(
    Effect.flatMap(({ createSecureSessionStorage }) =>
      Effect.promise(() => createSecureSessionStorage().getToken()),
    ),
  );

export function getSessionToken(): Promise<string | undefined> {
  return Effect.runPromise(sessionTokenEffect());
}
