// `GET /approvals`, `GET /approvals/:id` and `POST /approvals/:id/decision`
// (T-0941), mirroring web's mock: the list is the pending, unexpired rows; a
// second decision answers 409, like the server; `approve_always` also records
// the standing rule the AI panel lists.

import { currentUser } from '../../data/people';
import type { MockData } from '../../state';
import { errorResponse, jsonResponse, readJsonBody, type MockHttpRequest } from '../../http/shared';

const DECISIONS = ['approve_once', 'approve_always', 'deny'] as const;

export function handleApprovals(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'approvals') {
    return undefined;
  }
  if (request.segments.length === 1) {
    if (request.method !== 'GET') {
      return undefined;
    }
    return jsonResponse(pendingApprovals(data));
  }
  const id = decodeURIComponent(request.segments[1] ?? '');
  const approval = data.approvals.find((item) => item.id === id);
  if (approval === undefined) {
    return errorResponse('not_found', 'Approval not found', 404);
  }
  if (request.segments.length === 2 && request.method === 'GET') {
    return jsonResponse(approval);
  }
  if (
    request.segments.length === 3 &&
    request.segments[2] === 'decision' &&
    request.method === 'POST'
  ) {
    return decide(data, approval, request);
  }
  return undefined;
}

function pendingApprovals(data: MockData): readonly unknown[] {
  const now = Date.now();
  return data.approvals.filter(
    (approval) => approval.status === 'pending' && new Date(approval.expiresAt).getTime() > now,
  );
}

function decide(
  data: MockData,
  approval: MockData['approvals'][number],
  request: MockHttpRequest,
): Response {
  if (approval.status !== 'pending') {
    return errorResponse('not_pending', 'Approval request has already been decided', 409);
  }
  const body = readJsonBody(request.init);
  const decision = body.decision;
  if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    return errorResponse('invalid_request', 'Invalid decision body', 400);
  }
  const note = typeof body.note === 'string' ? body.note : null;
  approval.decidedAt = new Date().toISOString();
  approval.note = note;
  if (decision === 'approve_always') {
    approval.status = 'approved_always';
    addRule(data, approval);
  } else {
    approval.status = decision === 'deny' ? 'denied' : 'approved_once';
  }
  return jsonResponse(approval);
}

function addRule(data: MockData, approval: MockData['approvals'][number]): void {
  const existing = data.approvalRules.find(
    (rule) =>
      rule.aiId === approval.aiId &&
      rule.groupId === approval.groupId &&
      rule.action === approval.action,
  );
  if (existing !== undefined) {
    return;
  }
  data.approvalRules.push({
    id: `rule-${approval.id}-${approval.action}`,
    aiId: approval.aiId,
    action: approval.action,
    scope: approval.groupId === null ? 'personal' : 'group',
    groupId: approval.groupId,
    createdAt: new Date().toISOString(),
    createdBy: currentUser.id,
  });
}
