import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';

import {
  API_URL,
  type AuthRequestResult,
  createZilarAuthClient,
  sendSignInCode,
  signOutSession,
  verifySignInCode,
} from '../lib/auth';
import { fetchMe, updateMe } from '../lib/auth-api';
import { createSecureSessionStorage } from './secure-session-storage';
import { createAuthStore, toAuthError, type AuthApi, type AuthError } from './session-store';

const storage = createSecureSessionStorage();

// A rejected call keeps the error it threw.
const attempt = <A>(call: () => PromiseLike<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: call, catch: (error) => error });

const authClient = createZilarAuthClient({
  baseURL: API_URL,
  getToken: () => storage.getToken(),
  onToken: (token) => {
    // A failed write is dropped: the session still works until the next launch.
    Effect.runFork(Effect.ignore(attempt(() => storage.setToken(token))));
  },
});

const sendCode = (email: string, inviteCode: string | undefined) =>
  attempt<AuthRequestResult>(() => sendSignInCode(authClient, email, inviteCode)).pipe(
    Effect.map((result): { error?: AuthError } =>
      result.error === undefined || result.error === null
        ? {}
        : { error: toAuthError(result.error) },
    ),
  );

const verifyCode = (email: string, otp: string, inviteCode: string | undefined) =>
  attempt(() => verifySignInCode(authClient, email, otp, inviteCode)).pipe(
    Effect.map((result): { error?: AuthError; token?: string } => {
      const error =
        result.error === undefined || result.error === null ? undefined : toAuthError(result.error);
      return {
        ...(error === undefined ? {} : { error }),
        ...(result.token === undefined ? {} : { token: result.token }),
      };
    }),
  );

const api: AuthApi = {
  sendCode: (email, inviteCode) => runMobile(sendCode(email, inviteCode)),
  verifyCode: (email, otp, inviteCode) => runMobile(verifyCode(email, otp, inviteCode)),
  signOut: () => runMobile(attempt(() => signOutSession(authClient)).pipe(Effect.asVoid)),
  fetchMe: (token) => fetchMe(API_URL, token),
  updateMe: (token, name) => updateMe(API_URL, token, name),
};

/** The single app-wide session store. Screens read it through `useSession`. */
export const useAuthStore = createAuthStore({ api, storage });

/** Sends a sign-in code through the real server, carrying the invite when present. */
export function requestSignInCode(
  email: string,
  inviteCode?: string,
): Promise<{ error?: AuthError }> {
  return api.sendCode(email, inviteCode);
}

export interface SessionView {
  me: ReturnType<typeof useAuthStore.getState>['me'];
  loading: boolean;
  status: ReturnType<typeof useAuthStore.getState>['status'];
  signOut: () => Promise<void>;
}

/** The hook the chat screens will use once they move off mock data. */
export function useSession(): SessionView {
  const status = useAuthStore((state) => state.status);
  const me = useAuthStore((state) => state.me);
  const signOut = useAuthStore((state) => state.signOut);
  return { me, loading: status === 'loading', status, signOut };
}
