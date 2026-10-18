import type { ReactNode } from 'react';

import { RequireAuth } from '@/auth/RequireAuth';

import { useStickersApi } from './use-stickers-api';

/**
 * The sticker management screens need a session against the real API. In mock
 * mode the data is local, so the guard would only redirect to the login screen.
 */
export function RequireStickersAuth({ children }: { children: ReactNode }) {
  const { mock } = useStickersApi();
  if (mock) {
    return <>{children}</>;
  }
  return <RequireAuth>{children}</RequireAuth>;
}
