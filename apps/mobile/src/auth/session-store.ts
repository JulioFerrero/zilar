import { Effect } from 'effect';

import { runMobile } from '@/lib/effect/runtime';
import { markStartup } from '@/lib/startup-timing';

import { createBoundStore, type UseBoundStore } from '../store/atomStore';

import type { Me } from '../lib/auth-api';
import type { SessionStorage } from './session-storage';

export type AuthStatus = 'loading' | 'authenticated' | 'guest' | 'offline';

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

/** The first session retry waits 1 s; each one doubles, capped at 30 s (T-1304). */
export const RETRY_BASE_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

// A rejected call keeps the error it threw, so a caller sees what it saw.
const attempt = <A>(call: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: call, catch: (error) => error });

/** How loading the profile ended: a user, or a token the server rejected. */
type LoadedMe =
  | { readonly kind: 'me'; readonly me: Me }
  | { readonly kind: 'rejected'; readonly error: AuthError };

/** One attempt: `retry` loops inside `loadMe` and never reaches a caller. */
type MeAttempt = LoadedMe | { readonly kind: 'retry' };

/**
 * Loads the profile, retrying a transient failure (5xx, timeout, offline) with
 * backoff — 1 s, 2 s, 4 s … capped at 30 s — until the server answers or the
 * token is rejected (401). `onOffline` runs after every transient failure, so
 * the caller shows the offline state instead of signing the user out (T-1304).
 */
function loadMe(input: {
  token: string;
  api: AuthApi;
  wait: (ms: number) => Promise<void>;
  onOffline: () => void;
}): Effect.Effect<LoadedMe> {
  return Effect.gen(function* () {
    let attemptNumber = 0;
    for (;;) {
      const loaded = yield* attempt(() => input.api.fetchMe(input.token)).pipe(
        Effect.matchEffect({
          onSuccess: (me): Effect.Effect<MeAttempt> => Effect.succeed({ kind: 'me', me }),
          onFailure: (error): Effect.Effect<MeAttempt> =>
            isUnauthorized(error)
              ? Effect.succeed({ kind: 'rejected', error: toAuthError(error) })
              : Effect.sync(() => {
                  input.onOffline();
                }).pipe(Effect.as<MeAttempt>({ kind: 'retry' })),
        }),
      );
      if (loaded.kind !== 'retry') {
        return loaded;
      }
      yield* attempt(() => input.wait(retryDelayMs(attemptNumber))).pipe(Effect.ignore);
      attemptNumber += 1;
    }
  });
}

export function createAuthStore(deps: {
  api: AuthApi;
  storage: SessionStorage;
  /** Sleeps before the next session retry; tests inject a controllable stub. */
  wait?: (ms: number) => Promise<void>;
}): UseBoundStore<AuthStore> {
  const { api, storage } = deps;
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const clearTokenQuietly = Effect.ignore(attempt(() => storage.clearToken()));
  const persistMe = (me: Me): Effect.Effect<void> =>
    Effect.ignore(attempt(() => storage.setMe(me)));
  const readStoredMe = attempt(() => storage.getMe()).pipe(
    Effect.orElseSucceed((): Me | undefined => undefined),
  );

  return createBoundStore<AuthStore>((set) => {
    // Bumped on sign-out and sign-in so a background refresh that `bootstrap`
    // started can never write after the session it belonged to ended.
    let sessionRun = 0;

    const bootstrap = Effect.gen(function* () {
      const token = yield* attempt(() => storage.getToken()).pipe(
        Effect.orElseSucceed((): string | undefined => undefined),
      );
      if (token === undefined) {
        set({ status: 'guest', me: null });
        markStartup('session');
        return;
      }
      // The cached profile lets the app open on the chats while offline.
      const storedMe = yield* readStoredMe;
      if (storedMe !== undefined) {
        // Optimistic start: open on the stored profile at once — `authenticated`
        // is the status the guard treats as signed in with a user
        // (`guard.ts:27-30`) — then refresh it behind the app. Only a 401 signs
        // the user out; a transient failure keeps them in (T-1304).
        set({ status: 'authenticated', me: storedMe });
        markStartup('session');
        const run = (sessionRun += 1);
        const loaded = yield* loadMe({
          token,
          api,
          wait,
          onOffline: () => {
            if (run !== sessionRun) {
              return;
            }
            set((state) => ({ status: 'offline', me: state.me ?? storedMe }));
          },
        });
        if (run !== sessionRun) {
          return;
        }
        if (loaded.kind === 'rejected') {
          yield* clearTokenQuietly;
          set({ status: 'guest', me: null });
          return;
        }
        yield* persistMe(loaded.me);
        set({ status: 'authenticated', me: loaded.me });
        return;
      }
      const loaded = yield* loadMe({
        token,
        api,
        wait,
        onOffline: () => set((state) => ({ status: 'offline', me: state.me ?? storedMe ?? null })),
      });
      if (loaded.kind === 'rejected') {
        yield* clearTokenQuietly;
        set({ status: 'guest', me: null });
        return;
      }
      const me = loaded.me;
      yield* persistMe(me);
      set({ status: 'authenticated', me });
      markStartup('session');
    });

    const signIn = (input: SignInInput): Effect.Effect<SignInOutcome, unknown> =>
      Effect.gen(function* () {
        // A fresh sign-in owns the session: any background bootstrap refresh is
        // stale from here on.
        sessionRun += 1;
        const result = yield* attempt(() =>
          api.verifyCode(input.email, input.otp, input.inviteCode),
        );
        if (result.error !== undefined || result.token === undefined) {
          return { ok: false, error: result.error ?? { code: 'missing_token' } } as const;
        }
        const token = result.token;
        yield* attempt(() => storage.setToken(token));
        // A 5xx or a network error right after the code must not clear the
        // token: retry the profile and keep the user signed in (T-1304).
        const loaded = yield* loadMe({
          token,
          api,
          wait,
          onOffline: () => set((state) => ({ status: 'offline', me: state.me })),
        });
        if (loaded.kind === 'rejected') {
          yield* clearTokenQuietly;
          set({ status: 'guest', me: null });
          return { ok: false, error: loaded.error } as const;
        }
        const me = loaded.me;
        yield* persistMe(me);
        set({ status: 'authenticated', me });
        return { ok: true, me } as const;
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
                // `PATCH /me` carries no `avatarUrl`, so merge over the cached
                // profile instead of replacing it: a rename must not drop the
                // picture the session already holds (T-1334).
                set((state) => ({ me: state.me === null ? me : { ...state.me, ...me } }));
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
          Effect.andThen(
            Effect.sync(() => {
              // End the current session run: a bootstrap refresh still in
              // flight must not resurrect the profile it stored.
              sessionRun += 1;
              set({ status: 'guest', me: null });
            }),
          ),
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
