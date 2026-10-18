// effect-plain: promise-edge adapters beside the ports; the pipeline starts one layer up.
import { Effect } from 'effect';
import type { SessionCheck } from '@zilar/client-core/store';
import { authClient } from '../auth';
import { resetHandleGateDismissal } from '../handleGate';
import { writeStoredDevice } from '../push/deviceStorage';
import { resetIsServerOwnerCache } from '../useIsServerOwner';
import type { StorageLike } from '@/store/realStore';
import { clearChatListCache } from '@/store/chatListCache';
import { clearMessageCache } from '@/store/messageCache';
import { ApiError } from './http';
import { getMe } from './chats';

// A 200 means the session is alive and a 401 that it is gone; another status or a network
// error is unknown, so it never signs anyone out.
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

// Runs the persistent half of signOutStore (server sign-out, cache clears, push-device
// clear so the next account re-registers) and leaves for /login. The <disable/> stanza
// cannot be sent — the XMPP connection is down — but the local handle must not survive it.
export const sessionGone = (goToLogin: () => void, storage?: SessionGoneStorage): void => {
  const target = storage === undefined ? defaultSessionGoneStorage() : storage;
  clearChatListCache(target);
  clearMessageCache(target);
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
