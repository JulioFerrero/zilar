import { describe, expect, it } from 'vitest';
import { ApprovalRequestSchema } from '@galena/protocol';
import { approvals } from '../db/schema';
import {
  approvalCardBody,
  buildApprovalCardPayload,
  CANCELLED_NOTICE,
  FAILED_NOTICE,
  summaryForOutcome,
} from './announce';

type ApprovalRow = typeof approvals.$inferSelect;

function approvalRow(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'approval-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    action: 'demo.echo',
    summary: 'Echo hello',
    details: null,
    argsHash: 'a'.repeat(64),
    worstCaseCurrency: null,
    worstCaseAmount: null,
    requestedBy: 'owner-1@galena.localhost',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    note: null,
    expiresAt: new Date('2026-12-01T12:00:00Z'),
    createdAt: new Date('2026-12-01T11:00:00Z'),
    ...overrides,
  };
}

describe('approval card builder', () => {
  it('builds a valid payload for a group approval using the room JID', () => {
    const row = approvalRow({
      groupId: 'group-1',
      details: 'long body text',
      worstCaseCurrency: 'EUR',
      worstCaseAmount: '12.50',
    });
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: 'room123@rooms.galena.localhost',
    });
    expect(payload).not.toBeNull();
    if (payload === null) {
      return;
    }
    expect(payload.type).toBe('approval.request');
    expect(payload.v).toBe(0);
    if (payload.type !== 'approval.request') {
      return;
    }
    expect(payload.data).toEqual({
      id: 'approval-1',
      room: 'room123@rooms.galena.localhost',
      ai: 'ai-1@galena.localhost',
      action: 'demo.echo',
      summary: 'Echo hello',
      details: 'long body text',
      args_hash: 'a'.repeat(64),
      worst_case_cost: { currency: 'EUR', amount: 12.5 },
      requested_by: 'owner-1@galena.localhost',
      expires_at: '2026-12-01T12:00:00.000Z',
    });
    expect(ApprovalRequestSchema.safeParse(payload.data).success).toBe(true);
  });

  it('builds a valid payload for a DM using the owner bare JID as the room', () => {
    const row = approvalRow({ groupId: null });
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: null,
    });
    expect(payload).not.toBeNull();
    if (payload === null || payload.type !== 'approval.request') {
      return;
    }
    expect(payload.data.room).toBe('owner-1@galena.localhost');
    expect(payload.data.details).toBeUndefined();
    expect(payload.data.worst_case_cost).toBeUndefined();
  });

  it('omits optional fields when absent', () => {
    const row = approvalRow();
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: null,
    });
    if (payload === null || payload.type !== 'approval.request') {
      throw new Error('payload was null');
    }
    expect(payload.data.details).toBeUndefined();
    expect(payload.data.worst_case_cost).toBeUndefined();
  });

  it('returns null when details exceeds the 20000 char limit', () => {
    const row = approvalRow({ details: 'a'.repeat(20_001) });
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: null,
    });
    expect(payload).toBeNull();
  });

  it('returns null when the row carries an invalid hash', () => {
    const row = approvalRow({ argsHash: 'not-a-hash' });
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: null,
    });
    expect(payload).toBeNull();
  });

  it('returns null for a group approval with no room JID available', () => {
    const row = approvalRow({ groupId: 'group-1' });
    const payload = buildApprovalCardPayload({
      approval: row,
      aiJid: 'ai-1@galena.localhost',
      ownerJid: 'owner-1@galena.localhost',
      roomJid: null,
    });
    expect(payload).toBeNull();
  });
});

describe('approval card body', () => {
  it('uses Approval needed plus the summary', () => {
    const row = approvalRow({ summary: 'Echo hello' });
    expect(approvalCardBody(row)).toBe('Approval needed: Echo hello');
  });
});

describe('summaryForOutcome', () => {
  it('returns the adapter summary on executed', () => {
    expect(summaryForOutcome('executed', 'Echoed: hi')).toBe('Echoed: hi');
  });

  it('returns the fixed failed text on failed, ignoring any adapter text', () => {
    expect(summaryForOutcome('failed', 'SEVERE-LEAK')).toBe(FAILED_NOTICE);
  });

  it('returns the fixed cancelled text on cancelled', () => {
    expect(summaryForOutcome('cancelled', 'whatever')).toBe(CANCELLED_NOTICE);
  });
});
