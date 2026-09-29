import {
  ApprovalsApiError,
  type ApprovalDecision,
  type ApprovalStatus,
  type ApprovalsApi,
  type PublicApproval,
} from '../lib/approvals-api';

/**
 * Mock approvals API for the chat's approval card (T-0082). The mock mirrors the
 * server's `/api/approvals/:id` and `/api/approvals/:id/decision` endpoints, in
 * memory and scoped to the chat session: mutations survive navigation between
 * the chat and other screens but never cross sessions.
 *
 * One approval is seeded with the id used by the chat's mock approval card
 * payload (`mock/messages.ts` -> `APPROVAL`), so the card in the `dev-ai` chat
 * shows Approve / Deny in mock mode. A second decision on the same row answers
 * 409 `not_pending`, like the server.
 */

const SEED_ID = 'approval-2001';

const SEED_CREATED_AT = '2026-09-28T01:00:00.000Z';
const SEED_EXPIRES_AT = '2026-09-28T03:00:00.000Z';

function cloneSeed(): MockApproval {
  return {
    id: SEED_ID,
    status: 'pending',
    decidedAt: null,
    note: null,
  };
}

interface MockApproval {
  id: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  note: string | null;
}

function toPublic(approval: MockApproval): PublicApproval {
  // The wire shape's other fields are the same for every seeded/mock row; the
  // chat card renders the request text from the payload, not from this API.
  return {
    id: approval.id,
    aiId: 'ai-dev-1',
    groupId: null,
    action: 'Rotate the staging API token',
    summary: 'The staging token leaked in a CI log. Rotate it and update the CI secret.',
    details: null,
    argsHash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
    worstCase: { currency: 'EUR', amount: 0.02 },
    requestedBy: 'me@galena.chat',
    status: approval.status,
    decidedAt: approval.decidedAt,
    note: approval.note,
    expiresAt: SEED_EXPIRES_AT,
    createdAt: SEED_CREATED_AT,
  };
}

function decisionToStatus(decision: ApprovalDecision): ApprovalStatus {
  switch (decision) {
    case 'approve_once':
      return 'approved_once';
    case 'approve_always':
      return 'approved_always';
    case 'deny':
      return 'denied';
  }
}

let state: MockApproval = cloneSeed();

/**
 * Clears the mock state. Tests call this between cases so they do not depend
 * on the order they run in.
 */
export function resetApprovalsMock(): void {
  state = cloneSeed();
}

/** An `ApprovalsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockApprovalsApi(): ApprovalsApi {
  return {
    async getApproval(id) {
      if (id !== state.id) {
        throw new ApprovalsApiError(404, 'not_found', 'Approval not found');
      }
      return toPublic(state);
    },
    async decideApproval(id, decision, note) {
      if (id !== state.id) {
        throw new ApprovalsApiError(404, 'not_found', 'Approval not found');
      }
      if (state.status !== 'pending') {
        // The server's behaviour: a second decision on the same row fails with
        // 409 `not_pending`, so the card reloads and shows the outcome.
        throw new ApprovalsApiError(
          409,
          'not_pending',
          'Approval request has already been decided',
        );
      }
      const now = new Date().toISOString();
      state = {
        id: state.id,
        status: decisionToStatus(decision),
        decidedAt: now,
        note: note ?? null,
      };
      return toPublic(state);
    },
  };
}
