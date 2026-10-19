import { makeApprovalsApi, type ApprovalRule } from '@zilar/client-core';

export type {
  ApprovalDecision,
  ApprovalRule,
  ApprovalStatus,
  PublicApproval,
} from '@zilar/client-core';

export type ApprovalRuleScope = ApprovalRule['scope'];
export type ApprovalsApi = ReturnType<typeof makeApprovalsApi>;
