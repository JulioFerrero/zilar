import { runApi, type AuthInvite } from '@zilar/api-contract';
import { makeChatsApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Session required; answers `{ code, url, expiresAt }`.
 */

export type Invite = AuthInvite;

export interface InvitesApi {
  createInvite(): Promise<Invite>;
}

export function createInvitesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InvitesApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeChatsApi((call) => runApi(call(client)));
  return {
    createInvite: api.createInvite,
  };
}
