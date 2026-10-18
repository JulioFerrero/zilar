import type { ReactNode } from 'react';

import { RequireAuth } from '@/auth/RequireAuth';

import { useAisApi } from './use-ais-api';

/**
 * The AI screens need a session against the real API; in mock mode the data is local, and the auth guard would only redirect a screenshot session to login.
 */
export function RequireAisAuth({ children }: { children: ReactNode }) {
  const { mock } = useAisApi();
  if (mock) {
    return <>{children}</>;
  }
  return <RequireAuth>{children}</RequireAuth>;
}
