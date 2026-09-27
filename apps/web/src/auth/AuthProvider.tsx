import { createContext, useContext, type ReactNode } from 'react';
import { authClient } from '@/lib/auth';

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

/** Provides the Better Auth session. Tests can pass a fixed `value`. */
export function AuthProvider({ children, value }: { children: ReactNode; value?: AuthState }) {
  if (value !== undefined) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
