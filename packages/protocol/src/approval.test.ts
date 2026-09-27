import { describe, expect, it } from 'vitest';
import { ApprovalDecisionSchema, ApprovalRequestSchema } from './index';

const request = {
  id: 'a-1',
  room: 'project-a@rooms.example.com',
  ai: 'marketing@ai.example.com',
  action: 'ads.campaign.start',
  summary: 'Start the Autumn launch campaign',
  details: 'diff --git a/ads.ts b/ads.ts',
  args_hash: 'a'.repeat(64),
  worst_case_cost: { currency: 'EUR', amount: 912 },
  requested_by: 'ana@example.com',
  expires_at: '2026-09-27T12:00:00Z',
};

describe('ApprovalRequestSchema', () => {
  it('accepts a full approval request', () => {
    const result = ApprovalRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(request);
    }
  });

  it('accepts a request without optional fields', () => {
    const minimal = {
      id: request.id,
      room: request.room,
      ai: request.ai,
      action: request.action,
      summary: request.summary,
      args_hash: request.args_hash,
      requested_by: request.requested_by,
      expires_at: request.expires_at,
    };
    expect(ApprovalRequestSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects an uppercase args_hash', () => {
    expect(ApprovalRequestSchema.safeParse({ ...request, args_hash: 'A'.repeat(64) }).success).toBe(
      false,
    );
  });

  it('rejects a short args_hash', () => {
    expect(ApprovalRequestSchema.safeParse({ ...request, args_hash: 'a'.repeat(63) }).success).toBe(
      false,
    );
  });

  it('rejects a non-hex args_hash', () => {
    expect(ApprovalRequestSchema.safeParse({ ...request, args_hash: 'g'.repeat(64) }).success).toBe(
      false,
    );
  });

  it('rejects a summary longer than 500 characters', () => {
    expect(ApprovalRequestSchema.safeParse({ ...request, summary: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('rejects a missing requested_by', () => {
    const withoutRequester = {
      id: request.id,
      room: request.room,
      ai: request.ai,
      action: request.action,
      summary: request.summary,
      args_hash: request.args_hash,
      expires_at: request.expires_at,
    };
    expect(ApprovalRequestSchema.safeParse(withoutRequester).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(ApprovalRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
  });
});

const decision = {
  approval_id: 'a-1',
  decision: 'approve_once',
  note: 'Approved for this campaign only',
  decided_by: 'ana@example.com',
  decided_at: '2026-09-27T11:00:00Z',
};

describe('ApprovalDecisionSchema', () => {
  it('accepts a decision with a note', () => {
    const result = ApprovalDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(decision);
    }
  });

  it('accepts every documented decision', () => {
    for (const value of ['approve_once', 'approve_always', 'deny']) {
      expect(ApprovalDecisionSchema.safeParse({ ...decision, decision: value }).success).toBe(true);
    }
  });

  it('rejects an unknown decision', () => {
    expect(ApprovalDecisionSchema.safeParse({ ...decision, decision: 'maybe' }).success).toBe(
      false,
    );
  });

  it('rejects a note longer than 500 characters', () => {
    expect(ApprovalDecisionSchema.safeParse({ ...decision, note: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('rejects a missing decided_by', () => {
    const withoutDecider = {
      approval_id: decision.approval_id,
      decision: decision.decision,
      decided_at: decision.decided_at,
    };
    expect(ApprovalDecisionSchema.safeParse(withoutDecider).success).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(ApprovalDecisionSchema.safeParse({ ...decision, extra: true }).success).toBe(false);
  });
});
