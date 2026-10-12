// effect-plain: promise-edge adapters beside the ports (T-1223); the Effect
// pipeline starts one layer up in `onAuthFailed` (`fromPromise`).
import { Effect } from 'effect';
import type { SessionCheck } from '@zilar/client-core/store';
import { authClient } from '../auth';
import { resetHandleGateDismissal } from '../handleGate';
import { writeStoredDevice } from '../push/deviceStorage';
import { resetIsServerOwnerCache } from '../useIsServerOwner';
import type { StorageLike } from '@/store/realStore';
import { clearChatListCache } from '@/store/chatListCache';
import { ApiError } from './http';
import { getMe } from './chats';

/**
 * Asks `GET /api/me` (the same call the boot fetches with) whether the
 * session still exists after `authFailed` (T-1223): a 200 means the session
 * is alive, a 401 means it is gone, and anything else — another status or a
 * network error — is `unknown`, so it never signs anyone out. Runs as the
 * promise the core lifts with `fromPromise`, so its H1 signals stay here.
 */
export const checkSession = (): Promise<SessionCheck> =>
  Effect.runPromise(
    Effect.matchEffect(
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
  );

/** The storage `clearChatListCache` writes through, exposed for tests. */
export type SessionGoneStorage = StorageLike | null;

/**
 * Signs out after `checkSession` answered `gone`, so the user lands on
 * login (T-1223). Runs the persistent half of the `signOutStore` flow
 * (`store/effects/lifecycle.ts:105-118`): the server sign-out, the chat-list
 * cache clear, the push-device clear (so the next account must re-register
 * instead of re-enabling the previous user's node, T-1152), and the gate
 * dismissal + server-owner cache resets — then leaves for `/login`. The
 * `<disable/>` stanza itself cannot be sent (the XMPP connection is down),
 * but the local handle must not survive it.
 */
export const sessionGone = (goToLogin: () => void, storage?: SessionGoneStorage): void => {
  clearChatListCache(storage === undefined ? defaultSessionGoneStorage() : storage);
  resetIsServerOwnerCache();
  resetHandleGateDismissal();
  try {
    writeStoredDevice(null);
  } catch {
    // A blocked storage must never break the sign-out.
  }
  void authClient.signOut().finally(() => {
    goToLogin();
  });
};

const defaultSessionGoneStorage = (): SessionGoneStorage => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
