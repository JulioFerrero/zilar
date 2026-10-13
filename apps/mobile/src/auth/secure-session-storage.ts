import { Effect, Result, Schema } from 'effect';
import * as SecureStore from 'expo-secure-store';
import { struct } from '@zilar/protocol';

import { runMobile } from '@/lib/effect/runtime';

import type { Me } from '../lib/auth-api';
import type { SessionStorage } from './session-storage';

/** SecureStore key. One session token per install, cleared on sign-out. */
export const SESSION_TOKEN_KEY = 'zilar.session-token';

/** The last profile, kept beside the token so the app opens while offline (T-1304). */
export const SESSION_ME_KEY = 'zilar.session-me';

// The profile rides the same keychain as the token: it must decode exactly
// (a corrupted entry reads as "none", never as a partial user).
const storedMeSchema = struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  jid: Schema.NullOr(Schema.String),
  bio: Schema.optional(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
});

// A SecureStore failure stays the error it was, so callers see what they saw.
const secureCall = <A>(call: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: call, catch: (error) => error });

/** Decodes the cached profile; a missing or unusable value reads as `undefined`. */
function decodeStoredMe(value: string | null): Me | undefined {
  if (value === null || value === '') {
    return undefined;
  }
  try {
    const decoded = Schema.decodeUnknownResult(storedMeSchema)(JSON.parse(value) as unknown);
    return Result.isSuccess(decoded) ? decoded.success : undefined;
  } catch {
    return undefined;
  }
}

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
    clearToken: () =>
      runMobile(
        secureCall(() => SecureStore.deleteItemAsync(SESSION_TOKEN_KEY)).pipe(
          Effect.andThen(secureCall(() => SecureStore.deleteItemAsync(SESSION_ME_KEY))),
        ),
      ),
    getMe: () =>
      runMobile(
        secureCall(() => SecureStore.getItemAsync(SESSION_ME_KEY)).pipe(
          Effect.map((value) => decodeStoredMe(value)),
        ),
      ),
    setMe: (me) =>
      runMobile(secureCall(() => SecureStore.setItemAsync(SESSION_ME_KEY, JSON.stringify(me)))),
  };
}
