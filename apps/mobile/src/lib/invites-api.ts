import type { AuthInvite } from '@zilar/api-contract';
import { makeChatsApi } from '@zilar/client-core';

import type { ApiCall } from './effect/api-client';

/**
 * Session required; answers `{ code, url, expiresAt }`.
 */

export type Invite = AuthInvite;

export interface InvitesApi {
  createInvite(): Promise<Invite>;
}

export function makeInvitesApi(call: ApiCall): InvitesApi {
  const api = makeChatsApi(call);
  return {
    createInvite: api.createInvite,
  };
}
