import { createContext, useContext, useState, type ReactNode } from 'react';
import { authClient } from '@/lib/auth';
import { isMockMode } from '@/mock/gate';
import { currentUserId } from '@/mock/ids';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
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
  const state: AuthState =
    user !== undefined && user !== null
      ? {
          status: 'authenticated',
          user: { id: user.id, name: user.name ?? '', email: user.email },
          refetch,
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
    user: { id: currentUserId, name: 'You', email: 'you@galena.test' },
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
