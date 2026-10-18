import { ApiError, runApi, type PublicAuditEntry as ContractAuditEntry } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * `AuditApiError` is the shared `ApiError`, so the section shows fixed sentences, never server text.
 */

export type PublicAuditEntry = ContractAuditEntry;
export type AuditResult = PublicAuditEntry['result'];
export type AuditCost = NonNullable<PublicAuditEntry['cost']>;

export interface AuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

export interface AuditApi {
  listAiAudit(aiId: string, before?: string): Promise<AuditPage>;
  listGroupAudit(groupId: string, before?: string): Promise<AuditPage>;
}

export const AuditApiError = ApiError;
export type AuditApiError = ApiError;

export const AUDIT_PAGE_LIMIT = 20;

export function createAuditApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AuditApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async listAiAudit(aiId, before) {
      const page = await runApi(
        client.audit.list({
          query: {
            aiId,
            limit: AUDIT_PAGE_LIMIT,
            ...(before === undefined || before === '' ? {} : { before }),
          },
        }),
      );
      return { entries: [...page.entries], next: page.next };
    },
    async listGroupAudit(groupId, before) {
      const page = await runApi(
        client.audit.list({
          query: {
            groupId,
            limit: AUDIT_PAGE_LIMIT,
            ...(before === undefined || before === '' ? {} : { before }),
          },
        }),
      );
      return { entries: [...page.entries], next: page.next };
    },
  };
}
