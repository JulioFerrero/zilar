import { makeApprovalsApi, type ApprovalRule, type PublicApproval } from '@zilar/client-core';
import { runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type {
  ApprovalDecision,
  ApprovalRule,
  ApprovalStatus,
  PublicApproval,
} from '@zilar/client-core';

export type ApprovalWorstCase = NonNullable<PublicApproval['worstCase']>;
export type ApprovalRuleScope = ApprovalRule['scope'];
export type ApprovalsApi = ReturnType<typeof makeApprovalsApi>;

export function createApprovalsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ApprovalsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeApprovalsApi((call) => runApi(call(client)));
}
