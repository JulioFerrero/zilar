import { beforeEach, describe, expect, it } from 'vitest';

import { ApprovalsApiError } from '../lib/approvals-api';

import { createMockApprovalsApi, resetApprovalsMock } from './approvals';

const SEED_ID = 'approval-2001';

describe('createMockApprovalsApi', () => {
  beforeEach(() => {
    resetApprovalsMock();
  });

  it('serves the seeded approval as pending', async () => {
    const api = createMockApprovalsApi();
    const approval = await api.getApproval(SEED_ID);
    expect(approval.status).toBe('pending');
    expect(approval.id).toBe(SEED_ID);
    expect(approval.action).toBe('Rotate the staging API token');
  });

  it('answers 404 for unknown ids', async () => {
    const api = createMockApprovalsApi();
    await expect(api.getApproval('apr-99')).rejects.toBeInstanceOf(ApprovalsApiError);
    await expect(api.getApproval('apr-99')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('decides with approve_once and returns the decided row', async () => {
    const api = createMockApprovalsApi();
    const decided = await api.decideApproval(SEED_ID, 'approve_once');
    expect(decided.status).toBe('approved_once');
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.note).toBeNull();
  });

  it('decides with deny and keeps the note', async () => {
    const api = createMockApprovalsApi();
    const decided = await api.decideApproval(SEED_ID, 'deny', 'no thanks');
    expect(decided.status).toBe('denied');
    expect(decided.note).toBe('no thanks');
  });

  it('answers 409 not_pending on a second decision', async () => {
    const api = createMockApprovalsApi();
    await api.decideApproval(SEED_ID, 'approve_once');
    await expect(api.decideApproval(SEED_ID, 'deny')).rejects.toMatchObject({
      status: 409,
      code: 'not_pending',
    });
  });

  it('returns the decided status on a subsequent getApproval', async () => {
    const api = createMockApprovalsApi();
    await api.decideApproval(SEED_ID, 'approve_once');
    const fetched = await api.getApproval(SEED_ID);
    expect(fetched.status).toBe('approved_once');
    expect(fetched.decidedAt).not.toBeNull();
  });

  it('maps approve_always to approved_always', async () => {
    const api = createMockApprovalsApi();
    const decided = await api.decideApproval(SEED_ID, 'approve_always');
    expect(decided.status).toBe('approved_always');
  });

  it('answers 404 on a decision for an unknown id', async () => {
    const api = createMockApprovalsApi();
    await expect(api.decideApproval('apr-99', 'deny')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
