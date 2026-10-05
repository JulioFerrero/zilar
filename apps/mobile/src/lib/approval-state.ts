import {
  ApprovalsApiError,
  type ApprovalDecision,
  type ApprovalsApi,
  type PublicApproval,
} from './approvals-api';

export type ApprovalCardState =
  | { kind: 'loading' }
  | { kind: 'notDecidable' }
  | { kind: 'error' }
  | { kind: 'ready'; approval: PublicApproval };

export function approvalStatusLabel(approval: PublicApproval): string {
  switch (approval.status) {
    case 'pending':
      return 'Pending';
    case 'approved_once':
    case 'approved_always':
      return 'Approved';
    case 'denied':
      return 'Denied';
    case 'consumed':
      return 'Already used';
    case 'expired':
      return 'Expired';
  }
}

// A 404 means the viewer may not decide this request (or it does not exist):
// the card then shows no buttons and no error. Any other failure on the first
// load surfaces the request text with a Retry button.
export async function loadApprovalCardState(
  api: ApprovalsApi,
  approvalId: string,
): Promise<ApprovalCardState> {
  try {
    return { kind: 'ready', approval: await api.getApproval(approvalId) };
  } catch (error) {
    if (error instanceof ApprovalsApiError && error.status === 404) {
      return { kind: 'notDecidable' };
    }
    return { kind: 'error' };
  }
}

// The decide flow: success replaces the row; a 409 (race / expired) reloads the
// row so the card shows the latest state; any other error returns the message
// to surface inline. The caller drives `inFlight` itself.
export type DecisionOutcome =
  | { kind: 'ready'; approval: PublicApproval }
  | { kind: 'reloaded'; approval: PublicApproval | null }
  | { kind: 'error'; message: string };

export async function applyDecision(
  api: ApprovalsApi,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<DecisionOutcome> {
  try {
    const approval = await api.decideApproval(approvalId, decision);
    return { kind: 'ready', approval };
  } catch (error) {
    if (
      error instanceof ApprovalsApiError &&
      (error.code === 'not_pending' || error.code === 'expired')
    ) {
      const refreshed = await api.getApproval(approvalId).catch(() => null);
      return { kind: 'reloaded', approval: refreshed };
    }
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Could not send the decision',
    };
  }
}
