import { ApiError, runApi, type PublicAuditEntry as ContractAuditEntry } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The AI activity read API (`GET /api/audit?aiId=…`), the mobile twin of the
 * web client in `apps/web/src/lib/api.ts` (`listAudit`). A Promise port over
 * the client derived from the shared contract (`@zilar/api-contract`,
 * `audit.ts`, T-0893). `AuditApiError` is the shared `ApiError`, which keeps
 * the server's `code` and `status`, so the section can show fixed
 * user-facing sentences instead of server text.
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
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const AuditApiError = ApiError;
export type AuditApiError = ApiError;

/** Page size, matching web `PAGE_LIMIT` in `AiActivity.tsx`. */
export const AUDIT_PAGE_LIMIT = 20;

/** The production `AuditApi`: bearer auth, `fetch`, and the build-time API URL. */
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
  };
}
