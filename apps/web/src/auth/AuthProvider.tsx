import { createContext, useContext, useState, type ReactNode } from 'react';
import { Effect } from 'effect';
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

function LiveAuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  const user = data?.user;
  const userId = user?.id;
  // T-0163: the handle lives on `GET /api/me` (Better Auth's session user
  // has no handle field), fetched lazily once the session exists. While it
  // is loading — and if the fetch fails — `handle` stays `undefined` so the
  // gate does not redirect: a failed `GET /me` must not mean "no handle".
  // T-0165: the own picture rides the same fetch.
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
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
  const state: AuthState =
    user !== undefined && user !== null
      ? {
          status: 'authenticated',
          user: {
            id: user.id,
            name: user.name ?? '',
            email: user.email,
            handle,
            ...(avatarUrl === undefined ? {} : { avatarUrl }),
          },
          refetch: () =>
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
            ),
        }
      : isPending
        ? { status: 'loading', user: undefined, refetch }
        : { status: 'guest', user: undefined, refetch };

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
  if (isMockMode()) {
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
