// The list never carries a session token or an IP address.

import type { AuthSessions } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

export type { AuthSession } from '@zilar/api-contract';

export function listSessions(): Promise<AuthSessions> {
  return callApi((client) => client.auth.listSessions());
}

/** Signs out one other device; the server answers 204. */
export function revokeSession(id: string): Promise<void> {
  return callApi((client) => client.auth.revokeSession({ params: { id } }));
}
