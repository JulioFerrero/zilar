import {
  ApprovalRequestSchema,
  isValid,
  type ApprovalRequest,
  type Payload,
} from '@zilar/protocol';
import type { ApprovalRow } from '../db/rows';

// The narrow port the gateway calls; a rejection is swallowed and never changes an outcome.
export interface ActionAnnouncer {
  approvalRequested(input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    approvalId: string;
  }): Promise<void>;
  outcome(input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    status: 'executed' | 'failed' | 'cancelled';
    summary: string;
  }): Promise<void>;
}

// Caller-supplied so the card builder stays pure.
export interface BuildApprovalCardInput {
  approval: ApprovalRow;
  aiJid: string;
  ownerJid: string;
  roomJid: string | null;
}

// The adapter's error text must never reach a message, log line or audit entry.
export const FAILED_NOTICE = 'The action failed.';
export const CANCELLED_NOTICE = 'The request was not carried out.';

// `cancelled` carries the approval's own summary so two expiring approvals stay distinguishable.
export function summaryForOutcome(
  status: 'executed' | 'failed' | 'cancelled',
  adapterSummary: string | null,
): string {
  if (status === 'executed') {
    return adapterSummary ?? '';
  }
  if (status === 'failed') {
    return FAILED_NOTICE;
  }
  const summary = adapterSummary?.trim() ?? '';
  return summary.length > 0 ? `Not carried out: ${summary}` : CANCELLED_NOTICE;
}

export function approvalCardBody(approval: ApprovalRow): string {
  return `Approval needed: ${approval.summary}`;
}

// Returns `null` when the row cannot produce a payload `ApprovalRequestSchema` accepts.
export function buildApprovalCardPayload(input: BuildApprovalCardInput): Payload | null {
  const room = input.approval.groupId === null ? input.ownerJid : input.roomJid;
  if (room === null) {
    return null;
  }
  const data: ApprovalRequest = {
    id: input.approval.id,
    room,
    ai: input.aiJid,
    action: input.approval.action,
    summary: input.approval.summary,
    ...(input.approval.details === null ? {} : { details: input.approval.details }),
    args_hash: input.approval.argsHash,
    ...(input.approval.worstCaseCurrency !== null && input.approval.worstCaseAmount !== null
      ? {
          worst_case_cost: {
            currency: input.approval.worstCaseCurrency as 'EUR' | 'USD',
            amount: Number(input.approval.worstCaseAmount),
          },
        }
      : {}),
    requested_by: input.approval.requestedBy,
    expires_at: input.approval.expiresAt.toISOString(),
  };
  if (!isValid(ApprovalRequestSchema)(data)) {
    return null;
  }
  return { v: 0, type: 'approval.request', data };
}
