import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Effect, Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';
import { authClient } from '@/lib/auth';
import { getMe } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { runWeb } from '@/lib/effect/runtime';
import { useQuery } from '@/lib/effect/use-query';
import { isMockMode } from '@/mock/gate';
import { currentUserId } from '@/mock/ids';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  handle?: string | null | undefined;
  /** T-0165: the caller's own picture, when set. */
  avatarUrl?: string | undefined;
}

export interface AuthState {
  status: 'loading' | 'authenticated' | 'guest';
  user: AuthUser | undefined;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// The last user the session check confirmed, kept in `sessionStorage` so a
// reload while the server is down opens the app instead of `/login` (T-1304).
const LAST_USER_KEY = 'zilar:lastUser';

// Only the identity fields are remembered: the handle and picture come from
// `GET /api/me` and are unknown while the server is unreachable.
const storedUserSchema = struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

function readStoredUser(): AuthUser | undefined {
  try {
    const raw = window.sessionStorage.getItem(LAST_USER_KEY);
    if (raw === null) {
      return undefined;
    }
    const decoded = Schema.decodeUnknownResult(storedUserSchema)(JSON.parse(raw) as unknown);
    return Result.isSuccess(decoded)
      ? { id: decoded.success.id, name: decoded.success.name, email: decoded.success.email }
      : undefined;
  } catch {
    // A blocked storage or a bad value only costs the reload case.
    return undefined;
  }
}

function writeStoredUser(user: AuthUser): void {
  try {
    window.sessionStorage.setItem(
      LAST_USER_KEY,
      JSON.stringify({ id: user.id, name: user.name, email: user.email }),
    );
  } catch {
    // Best effort only.
  }
}

function clearStoredUser(): void {
  try {
    window.sessionStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Best effort only.
  }
}

function isOnLoginPage(): boolean {
  try {
    return window.location.pathname === '/login';
  } catch {
    // A missing `location` only means "not the login page".
    return false;
  }
}

// The remembered user keeps the chats open while the server is down; the login
// page has no session to keep. A deliberate sign-out lands there even when its
// `authClient.signOut()` call failed — the store's `goToLogin` reloads the page
// — so the cache must not survive it (T-1304). Starting on the login page with
// the cached user would make `LoginPage` redirect straight back into the app.
function rememberedUserAtMount(): AuthUser | undefined {
  if (isOnLoginPage()) {
    clearStoredUser();
    return undefined;
  }
  return readStoredUser();
}

/** The first session retry waits 1 s; each one doubles, capped at 30 s (T-1304). */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

function LiveAuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error, refetch } = authClient.useSession();
  const user = data?.user;
  const userId = user?.id;
  // T-0163: the handle lives on `GET /api/me` (Better Auth's session user
  // has no handle field), fetched lazily once the session exists. While it
  // is loading — and if the fetch fails — `handle` stays `undefined` so the
  // gate does not redirect: a failed `GET /me` must not mean "no handle".
  // T-0165: the own picture rides the same fetch.
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  // The last user the session check confirmed, in memory plus sessionStorage.
  const [knownUser, setKnownUser] = useState<AuthUser | undefined>(() => rememberedUserAtMount());
  // The fetch is a query keyed on the user id: a new id or an unmount
  // interrupts it, so a late answer never lands. A failure is ignored
  // (failure keeps `handle` undefined — see above).
  useQuery(
    () =>
      userId === undefined
        ? Effect.void
        : fromApi(() => getMe()).pipe(
            Effect.tap((me) =>
              Effect.sync(() => {
                setHandle(me.handle ?? null);
                setAvatarUrl(me.avatarUrl);
              }),
            ),
            Effect.ignore,
          ),
    [userId],
  );
  const sessionError = error ?? null;
  // A session check that fails without a 401 is a transient outage (5xx,
  // timeout, offline), never a sign-out (T-1304).
  const transientError = sessionError !== null && sessionError.status !== 401;
  const isGuest = user === undefined && !isPending && !transientError;

  // Remember the confirmed user in memory and sessionStorage, and drop it on a
  // real sign-out, so a reload while the server is down stays signed in. The
  // writes ride a query's Effect, never a synchronous setState in an effect.
  useQuery(() => {
    if (user !== undefined) {
      const next: AuthUser = { id: user.id, name: user.name ?? '', email: user.email };
      return Effect.sync(() => {
        setKnownUser(next);
        writeStoredUser(next);
      });
    }
    if (isGuest) {
      return Effect.sync(() => {
        setKnownUser(undefined);
        clearStoredUser();
      });
    }
    return Effect.void;
  }, [userId, user?.name, user?.email, isGuest]);

  // A transient session failure retries `refetch` with the same backoff, so the
  // app comes back on its own and never falls back to `/login` (T-1304). Only
  // while no session data is known: with `data` intact, better-auth already
  // keeps the previous user.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    if (!transientError || user !== undefined) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const schedule = (): void => {
      timer = setTimeout(() => {
        // `refetch` is better-auth's `fetchSession`, which resolves to `void`
        // and never rejects (the session atom catches the fetch error), so the
        // `.finally()` below cannot become an unhandled rejection.
        void refetchRef.current().finally(() => {
          if (!cancelled) {
            attempt += 1;
            schedule();
          }
        });
      }, retryDelayMs(attempt));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [transientError, user]);

  const refetchUser = (): Promise<void> =>
    runWeb(
      fromApi(() => getMe()).pipe(
        Effect.orElseSucceed(() => null),
        // A failed refetch keeps the previous handle: failure is not
        // absence (see the query above).
        Effect.tap((me) =>
          me === null
            ? Effect.void
            : Effect.sync(() => {
                setHandle(me.handle ?? null);
                setAvatarUrl(me.avatarUrl);
              }),
        ),
        Effect.andThen(Effect.promise(() => refetch())),
      ),
    );

  const liveUser: AuthUser | undefined =
    user !== undefined && user !== null
      ? {
          id: user.id,
          name: user.name ?? '',
          email: user.email,
          handle,
          ...(avatarUrl === undefined ? {} : { avatarUrl }),
        }
      : undefined;

  let state: AuthState;
  if (liveUser !== undefined) {
    state = { status: 'authenticated', user: liveUser, refetch: refetchUser };
  } else if (transientError) {
    // Keep the app: the last known user renders, otherwise keep loading. A
    // server that is merely down never becomes `/login` (T-1304).
    state =
      knownUser !== undefined
        ? { status: 'authenticated', user: knownUser, refetch: refetchUser }
        : { status: 'loading', user: undefined, refetch };
  } else if (isPending) {
    state = { status: 'loading', user: undefined, refetch };
  } else {
    state = { status: 'guest', user: undefined, refetch };
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/**
 * Mock mode needs no session server (T-0069): report the fixed user the mock
 * store uses, so RequireAuth lets the app through without Better Auth.
 */
function MockAuthProvider({ children }: { children: ReactNode }) {
  const [state] = useState<AuthState>(() => ({
    status: 'authenticated',
    user: { id: currentUserId, name: 'You', email: 'you@zilar.test' },
    refetch: () => runWeb(Effect.void),
  }));

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** Provides the Better Auth session. Tests can pass a fixed `value`. */
export function AuthProvider({ children, value }: { children: ReactNode; value?: AuthState }) {
  if (value !== undefined) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }
  // The build-time condition (the same as `resolveMockMode` accepts) is inline,
  // so Vite folds the mock provider and mock/ids out of a production build.
  if (
    (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1') &&
    isMockMode()
  ) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }
  return <LiveAuthProvider>{children}</LiveAuthProvider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === null) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return state;
}
