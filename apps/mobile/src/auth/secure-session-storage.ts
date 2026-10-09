import { Effect } from 'effect';
import * as SecureStore from 'expo-secure-store';

import { runMobile } from '@/lib/effect/runtime';

import type { SessionStorage } from './session-storage';

/** SecureStore key. One session token per install, cleared on sign-out. */
export const SESSION_TOKEN_KEY = 'zilar.session-token';

// A SecureStore failure stays the error it was, so callers see what they saw.
const secureCall = <A>(call: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: call, catch: (error) => error });

/**
 * The session token lives in the OS keychain/keystore via SecureStore, never in
 * plain AsyncStorage, which is unencrypted and readable by other apps' backups.
 */
export function createSecureSessionStorage(): SessionStorage {
  return {
    getToken: () =>
      runMobile(
        secureCall(() => SecureStore.getItemAsync(SESSION_TOKEN_KEY)).pipe(
          Effect.map((value) => (value === null || value === '' ? undefined : value)),
        ),
      ),
    setToken: (token) =>
      runMobile(secureCall(() => SecureStore.setItemAsync(SESSION_TOKEN_KEY, token))),
    clearToken: () => runMobile(secureCall(() => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY))),
  };
}
