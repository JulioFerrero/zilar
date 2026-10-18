import { Effect } from 'effect';

/**
 * `expo-secure-store` is imported dynamically so this module loads under Vitest (Node), which cannot import the native module.
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
