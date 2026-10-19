import { runApi, type PublicAuditEntry } from '@zilar/api-contract';
import { makeAuditApi, type AuditApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

// Errors are the shared `ApiError`, so the section shows fixed sentences, never server text.

export type { PublicAuditEntry };
export type { AuditApi, ListAuditPage as AuditPage } from '@zilar/client-core';
export type AuditResult = PublicAuditEntry['result'];
export type AuditCost = NonNullable<PublicAuditEntry['cost']>;

export function createAuditApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AuditApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeAuditApi((call) => runApi(call(client)));
}
