// The caller's own sessions (T-1235). The endpoints and schemas live in
// `@zilar/api-contract` (`auth.ts`); this wrapper keeps the derived-client
// call next to the other feature modules. The list never carries a session
// token or an IP address.

import type { AuthSessions } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

export type { AuthSession } from '@zilar/api-contract';

/** The caller's sessions, newest `updatedAt` first, with `current` on this one. */
export function listSessions(): Promise<AuthSessions> {
  return callApi((client) => client.auth.listSessions());
}

/** Signs out one other device; the server answers 204. */
export function revokeSession(id: string): Promise<void> {
  return callApi((client) => client.auth.revokeSession({ params: { id } }));
}
