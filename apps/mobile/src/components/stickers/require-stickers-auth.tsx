import type { ReactNode } from 'react';

import { RequireAuth } from '@/auth/RequireAuth';

import { useStickersApi } from './use-stickers-api';

/**
 * The sticker management screens need a session against the real API. In
 * mock mode the data is local, so there is nothing to authenticate against
 * and the auth guard would only redirect a screenshot session to the login
 * screen (the `RequireAisAuth` pattern).
 */
export function RequireStickersAuth({ children }: { children: ReactNode }) {
  const { mock } = useStickersApi();
  if (mock) {
    return <>{children}</>;
  }
  return <RequireAuth>{children}</RequireAuth>;
}
