import { makeApprovalsApi, type ApprovalRule, type PublicApproval } from '@zilar/client-core';

export type {
  ApprovalDecision,
  ApprovalRule,
  ApprovalStatus,
  PublicApproval,
} from '@zilar/client-core';

export type ApprovalWorstCase = NonNullable<PublicApproval['worstCase']>;
export type ApprovalRuleScope = ApprovalRule['scope'];
export type ApprovalsApi = ReturnType<typeof makeApprovalsApi>;
