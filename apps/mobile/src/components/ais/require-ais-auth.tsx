import type { ReactNode } from 'react';

import { RequireAuth } from '@/auth/RequireAuth';

import { useAisApi } from './use-ais-api';

/**
 * The AI screens need a session against the real API. In mock mode the data is
 * local, so there is nothing to authenticate against and the auth guard would
 * only redirect a screenshot session to the login screen.
 */
export function RequireAisAuth({ children }: { children: ReactNode }) {
  const { scenario } = useAisApi();
  if (scenario !== null) {
    return <>{children}</>;
  }
  return <RequireAuth>{children}</RequireAuth>;
}
