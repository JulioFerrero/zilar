// effect-plain: promise-edge adapters beside the ports.
import { ApiError } from '@zilar/api-contract';
import { Effect } from 'effect';
import type { SessionCheck } from '@zilar/client-core/store';
import type { TokenProvider } from '../../lib/chat-api';
import { getSessionToken } from '../../lib/session-token';

/** A missing token and a 401 read as gone, anything else as `unknown`, so it never signs anyone out. */
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
                      error instanceof ApiError && error.status === 401
                        ? ('gone' as SessionCheck)
                        : ('unknown' as SessionCheck),
                    ),
                  onSuccess: () => Effect.succeed('valid' as SessionCheck),
                },
              ),
      },
    ),
  );

/** The dynamic import keeps this module loadable under Vitest; never rejects, so a failed import cannot leave the revoked session stuck on "Connecting…". */
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
