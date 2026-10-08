import { describe, expect, it } from 'vitest';
import { ApprovalDecisionSchema, ApprovalRequestSchema, decodeOrThrow, isValid } from './index';

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
    expect(isValid(ApprovalRequestSchema)(request)).toBe(true);
    expect(decodeOrThrow(ApprovalRequestSchema)(request)).toEqual(request);
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
    expect(isValid(ApprovalRequestSchema)(minimal)).toBe(true);
  });

  it('rejects an uppercase args_hash', () => {
    expect(isValid(ApprovalRequestSchema)({ ...request, args_hash: 'A'.repeat(64) })).toBe(false);
  });

  it('rejects a short args_hash', () => {
    expect(isValid(ApprovalRequestSchema)({ ...request, args_hash: 'a'.repeat(63) })).toBe(false);
  });

  it('rejects a non-hex args_hash', () => {
    expect(isValid(ApprovalRequestSchema)({ ...request, args_hash: 'g'.repeat(64) })).toBe(false);
  });

  it('rejects a summary longer than 500 characters', () => {
    expect(isValid(ApprovalRequestSchema)({ ...request, summary: 'a'.repeat(501) })).toBe(false);
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
    expect(isValid(ApprovalRequestSchema)(withoutRequester)).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(ApprovalRequestSchema)({ ...request, extra: true })).toBe(false);
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
    expect(isValid(ApprovalDecisionSchema)(decision)).toBe(true);
    expect(decodeOrThrow(ApprovalDecisionSchema)(decision)).toEqual(decision);
  });

  it('accepts every documented decision', () => {
    for (const value of ['approve_once', 'approve_always', 'deny']) {
      expect(isValid(ApprovalDecisionSchema)({ ...decision, decision: value })).toBe(true);
    }
  });

  it('rejects an unknown decision', () => {
    expect(isValid(ApprovalDecisionSchema)({ ...decision, decision: 'maybe' })).toBe(false);
  });

  it('rejects a note longer than 500 characters', () => {
    expect(isValid(ApprovalDecisionSchema)({ ...decision, note: 'a'.repeat(501) })).toBe(false);
  });

  it('rejects a missing decided_by', () => {
    const withoutDecider = {
      approval_id: decision.approval_id,
      decision: decision.decision,
      decided_at: decision.decided_at,
    };
    expect(isValid(ApprovalDecisionSchema)(withoutDecider)).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(ApprovalDecisionSchema)({ ...decision, extra: true })).toBe(false);
  });
});
