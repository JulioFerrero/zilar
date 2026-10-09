import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';

import { createBoundStore, type UseBoundStore } from '../store/atomStore';

import type { Me } from '../lib/auth-api';
import type { SessionStorage } from './session-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

/** A normalized auth failure, so screens don't depend on the client's error type. */
export interface AuthError {
  code?: string;
  message?: string;
  status?: number;
}

/** The network calls the session store needs. Injected so tests use fakes. */
export interface AuthApi {
  sendCode(email: string, inviteCode?: string): Promise<{ error?: AuthError }>;
  verifyCode(
    email: string,
    otp: string,
    inviteCode?: string,
  ): Promise<{ error?: AuthError; token?: string }>;
  signOut(): Promise<void>;
  fetchMe(token: string): Promise<Me>;
  updateMe(token: string, name: string): Promise<Me>;
}

export interface SignInInput {
  email: string;
  otp: string;
  inviteCode?: string;
}

export type SignInOutcome = { ok: true; me: Me } | { ok: false; error: AuthError };

export interface AuthStore {
  status: AuthStatus;
  me: Me | null;
  /** Restores a persisted session on start; no token means guest. */
  bootstrap(): Promise<void>;
  /** Verifies the code, persists the token and loads the profile. */
  signIn(input: SignInInput): Promise<SignInOutcome>;
  /** Saves the display name through `PATCH /api/me`. */
  setName(name: string): Promise<{ ok: boolean; error?: AuthError }>;
  /** Ends the remote session and clears the stored token. */
  signOut(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Maps any thrown value or client error into the small `AuthError` shape. */
export function toAuthError(error: unknown): AuthError {
  if (!isRecord(error)) {
    return {};
  }
  const result: AuthError = {};
  if (typeof error['code'] === 'string') result.code = error['code'];
  if (typeof error['message'] === 'string') result.message = error['message'];
  if (typeof error['status'] === 'number') result.status = error['status'];
  return result;
}

function isUnauthorized(error: unknown): boolean {
  return isRecord(error) && error['status'] === 401;
}

// A rejected call keeps the error it threw, so a caller sees what it saw.
const attempt = <A>(call: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: call, catch: (error) => error });

export function createAuthStore(deps: {
  api: AuthApi;
  storage: SessionStorage;
}): UseBoundStore<AuthStore> {
  const { api, storage } = deps;

  const clearTokenQuietly = Effect.ignore(attempt(() => storage.clearToken()));

  return createBoundStore<AuthStore>((set) => {
    const bootstrap = Effect.gen(function* () {
      const token = yield* attempt(() => storage.getToken()).pipe(
        Effect.orElseSucceed((): string | undefined => undefined),
      );
      if (token === undefined) {
        set({ status: 'guest', me: null });
        return;
      }
      yield* attempt(() => api.fetchMe(token)).pipe(
        Effect.matchEffect({
          onSuccess: (me) => Effect.sync(() => set({ status: 'authenticated', me })),
          onFailure: (error) =>
            (isUnauthorized(error) ? clearTokenQuietly : Effect.void).pipe(
              Effect.andThen(Effect.sync(() => set({ status: 'guest', me: null }))),
            ),
        }),
      );
    });

    const signIn = (input: SignInInput): Effect.Effect<SignInOutcome, unknown> =>
      Effect.gen(function* () {
        const result = yield* attempt(() =>
          api.verifyCode(input.email, input.otp, input.inviteCode),
        );
        if (result.error !== undefined || result.token === undefined) {
          return { ok: false, error: result.error ?? { code: 'missing_token' } } as const;
        }
        const token = result.token;
        yield* attempt(() => storage.setToken(token));
        return yield* attempt(() => api.fetchMe(token)).pipe(
          Effect.matchEffect({
            onSuccess: (me) =>
              Effect.sync((): SignInOutcome => {
                set({ status: 'authenticated', me });
                return { ok: true, me };
              }),
            onFailure: (error) =>
              clearTokenQuietly.pipe(
                Effect.as<SignInOutcome>({ ok: false, error: toAuthError(error) }),
              ),
          }),
        );
      });

    const setName = (name: string): Effect.Effect<{ ok: boolean; error?: AuthError }, unknown> =>
      Effect.gen(function* () {
        const token = yield* attempt(() => storage.getToken());
        if (token === undefined) {
          return { ok: false, error: { code: 'unauthorized' } };
        }
        return yield* attempt(() => api.updateMe(token, name)).pipe(
          Effect.matchEffect({
            onSuccess: (me) =>
              Effect.sync(() => {
                set({ me });
                return { ok: true };
              }),
            onFailure: (error) => Effect.succeed({ ok: false, error: toAuthError(error) }),
          }),
        );
      });

    // Signing out locally must always succeed, even when offline.
    const signOut = Effect.ignore(attempt(() => api.signOut())).pipe(
      Effect.ensuring(
        clearTokenQuietly.pipe(
          Effect.andThen(Effect.sync(() => set({ status: 'guest', me: null }))),
        ),
      ),
    );

    return {
      status: 'loading',
      me: null,
      bootstrap: () => runMobile(bootstrap),
      signIn: (input) => runMobile(signIn(input)),
      setName: (name) => runMobile(setName(name)),
      signOut: () => runMobile(signOut),
    };
  });
}
