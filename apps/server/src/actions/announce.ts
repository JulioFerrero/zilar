import { ApprovalRequestSchema, type ApprovalRequest, type Payload } from '@galena/protocol';
import { approvals } from '../db/schema';

// The approval row shape: just the column inference from the schema, since
// `db/schema.ts` does not export a named type for it.
type ApprovalRow = typeof approvals.$inferSelect;

// The narrow port the action gateway calls. Every call is best-effort: the
// gateway swallows a rejection from the announcer and never lets it change an
// outcome, a row or an audit entry.
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

// The inputs the card builder needs that are not on the approval row itself:
// the AI's JID, the owner's bare JID (used as the `room` when the request was
// raised in a DM), and the room JID (used as the `room` for a group). The
// gateway already has these from its own lookups; it passes them in so the
// builder stays pure.
export interface BuildApprovalCardInput {
  approval: ApprovalRow;
  aiJid: string;
  ownerJid: string;
  roomJid: string | null;
}

// The fixed text the platform posts when the action finished without a
// success summary. The adapter's error text must never reach a message, a
// log line or an audit entry — these strings are what the chat sees.
export const FAILED_NOTICE = 'The action failed.';
export const CANCELLED_NOTICE = 'The request was not carried out.';

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
  return CANCELLED_NOTICE;
}

// Builds the body of the card message. Plain text, no payload — the
// `approval.request` payload goes on the same message via `buildApprovalCard`.
export function approvalCardBody(approval: ApprovalRow): string {
  return `Approval needed: ${approval.summary}`;
}

// Pure builder for the `approval.request` payload. Returns `null` when the
// approval row cannot produce a payload that `ApprovalRequestSchema` accepts
// (over-long `details`, invalid hash, missing fields). The caller skips the
// send and logs the class name only.
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
  const parsed = ApprovalRequestSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  return { v: 0, type: 'approval.request', data: parsed.data };
}
