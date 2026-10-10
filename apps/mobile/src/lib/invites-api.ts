import { ApiError, runApi, type AuthInvite } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The personal-invite API (`POST /api/invites`), the mobile twin of the web
 * client (`createInvite()` in `apps/web/src/lib/api.ts`). The route comes from
 * the client derived from the shared contract (`@zilar/api-contract`,
 * `auth.ts`, T-0895); it answers `{ code, url, expiresAt }`, session required.
 */

export type Invite = AuthInvite;

export interface InvitesApi {
  createInvite(): Promise<Invite>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const InvitesApiError = ApiError;
export type InvitesApiError = ApiError;

/** The production `InvitesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInvitesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InvitesApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    createInvite: () => runApi(client.auth.createInvite()),
  };
}
