import {
  runApi,
  type ApprovalRule as ContractApprovalRule,
  type PublicApproval as ContractApproval,
} from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Errors are the shared `ApiError`, so the card branches on `status` without parsing the message (404 = not decidable, 409 = race / expired).
 */

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export interface ApprovalWorstCase {
  currency: 'EUR' | 'USD';
  amount: number;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  aiName: string;
  groupName: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: ApprovalWorstCase | null;
  requestedBy: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  alwaysEligible: boolean;
}

export interface ApprovalsApi {
  getApproval(id: string): Promise<PublicApproval>;
  decideApproval(id: string, decision: ApprovalDecision, note?: string): Promise<PublicApproval>;
  listApprovals(): Promise<PublicApproval[]>;
  listAiApprovalRules(aiId: string): Promise<ApprovalRule[]>;
  listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]>;
  revokeApprovalRule(id: string): Promise<void>;
}

export type ApprovalRuleScope = 'personal' | 'group';

export interface ApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  topicId: string | null;
  topicName: string | null;
  createdAt: string;
  createdBy: string;
}

export function buildDecisionBody(
  decision: ApprovalDecision,
  note?: string,
): Record<string, unknown> {
  return note === undefined ? { decision } : { decision, note };
}

// An older server may omit a name or flag; it then reads as the empty default (as the contract does).
function toPublicApproval(row: ContractApproval): PublicApproval {
  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    aiName: row.aiName ?? '',
    groupName: row.groupName ?? null,
    action: row.action,
    summary: row.summary,
    details: row.details,
    argsHash: row.argsHash,
    worstCase: row.worstCase,
    requestedBy: row.requestedBy,
    status: row.status,
    decidedAt: row.decidedAt,
    note: row.note,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    alwaysEligible: row.alwaysEligible ?? false,
  };
}

// Optional on the wire; an absent topic field reads as `null`.
function toApprovalRule(rule: ContractApprovalRule): ApprovalRule {
  return {
    id: rule.id,
    action: rule.action,
    scope: rule.scope,
    groupId: rule.groupId,
    topicId: rule.topicId ?? null,
    topicName: rule.topicName ?? null,
    createdAt: rule.createdAt,
    createdBy: rule.createdBy,
  };
}

export function createApprovalsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ApprovalsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async getApproval(id) {
      return toPublicApproval(await runApi(client.approvals.detail({ params: { id } })));
    },
    async decideApproval(id, decision, note) {
      const result = await runApi(
        client.approvals.decide({
          params: { id },
          payload: note === undefined ? { decision } : { decision, note },
        }),
      );
      return toPublicApproval(result);
    },
    async listApprovals() {
      const rows = await runApi(client.approvals.list());
      return rows.map(toPublicApproval);
    },
    async listAiApprovalRules(aiId) {
      const rows = await runApi(client.approvals.aiRules({ params: { id: aiId } }));
      return rows.map(toApprovalRule);
    },
    async listGroupApprovalRules(groupId) {
      const rows = await runApi(client.approvals.groupRules({ params: { id: groupId } }));
      return rows.map(toApprovalRule);
    },
    async revokeApprovalRule(id) {
      await runApi(client.approvals.revokeRule({ params: { id } }));
    },
  };
}
