import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth';
import { getMe } from '@/lib/api';
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
  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    // The effect only synchronizes with the session (the lint rule flags
    // synchronous setState inside effects); the fetch promise resolves the
    // next state, applied once.
    let active = true;
    // Handled rejection (failure keeps `handle` undefined — see above), so
    // no unhandled rejection escapes when the request fails.
    void getMe().then(
      (me) => {
        if (active) {
          setHandle(me.handle ?? null);
          setAvatarUrl(me.avatarUrl);
        }
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [userId]);
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
          refetch: async () => {
            const me = await getMe().catch(() => null);
            // A failed refetch keeps the previous handle: failure is not
            // absence (see the effect above).
            if (me !== null) {
              setHandle(me.handle ?? null);
              setAvatarUrl(me.avatarUrl);
            }
            await refetch();
          },
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
    refetch: async () => {},
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
