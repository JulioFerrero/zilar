// effect-plain: promise-edge adapters beside the ports (T-1223); the Effect
// pipeline starts one layer up in `onAuthFailed` (`fromPromise`).
import { Effect } from 'effect';
import type { SessionCheck } from '@zilar/client-core/store';
import { ChatApiError, type TokenProvider } from '../../lib/chat-api';
import { getSessionToken } from '../../lib/session-token';

/**
 * Asks `GET /api/me` (the same call the boot fetches with,
 * `lib/chat-api.ts:169`) whether the session still exists after `authFailed`
 * (T-1223): a missing token reads as the session gone, a 200 as valid, a
 * 401 as gone, and anything else — another status or a network error — as
 * `unknown`, so it never signs anyone out. `getToken` rides a parameter so
 * tests inject a fake; the store passes the live one. Runs as the promise
 * the core lifts with `fromPromise`, so its H1 signals stay here.
 */
export const checkSession = (
  getToken: TokenProvider = getSessionToken,
  getMe: () => Promise<unknown>,
): Promise<SessionCheck> =>
  Effect.runPromise(
    Effect.matchEffect(
      Effect.tryPromise({
        try: () => getToken(),
        catch: (error) => error,
      }),
      {
        onFailure: () => Effect.succeed('unknown' as SessionCheck),
        onSuccess: (token) =>
          token === undefined
            ? Effect.succeed('gone' as SessionCheck)
            : Effect.matchEffect(
                Effect.tryPromise({
                  try: () => getMe(),
                  catch: (error) => error,
                }),
                {
                  onFailure: (error: unknown) =>
                    Effect.succeed(
                      error instanceof ChatApiError && error.status === 401
                        ? ('gone' as SessionCheck)
                        : ('unknown' as SessionCheck),
                    ),
                  onSuccess: () => Effect.succeed('valid' as SessionCheck),
                },
              ),
      },
    ),
  );

/**
 * Signs out after `checkSession` answered `gone`, so the user lands on
 * login (T-1223): the session store's `signOut` clears the token, the status
 * flips to `guest` and `RequireAuth` redirects to login. `signOut` rides a
 * parameter so tests inject a fake; the store passes the live one. The
 * import is dynamic so this module loads under Vitest, like
 * `session-token.ts`. Never rejects: a failed import must not leave an
 * unhandled rejection with the revoked session stuck on "Connecting…".
 */
export const sessionGone = (
  signOut: () => Promise<unknown> | unknown = defaultSignOut,
): Promise<void> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => signOut() as Promise<unknown>,
      catch: (error) => error,
    }).pipe(Effect.ignore),
  );

const defaultSignOut = async (): Promise<void> => {
  const { useAuthStore } = await import('../../auth/session');
  await useAuthStore.getState().signOut();
};
