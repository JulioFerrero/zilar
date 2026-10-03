import { describe, expect, it } from 'vitest';

import type { ApprovalRule, PublicApproval } from '@/lib/approvals-api';
import { ApprovalsApiError } from '@/lib/approvals-api';

import { decidedAgoText, expiresInText, worstCaseText } from './format-relative';
import {
  decideScreenRow,
  groupRulesForScreen,
  orderedRows,
  revokeFailedOutcome,
  rowsForList,
  SCREEN_DECISIONS,
  type OwnedScreenRule,
} from './rows';

const NOW = new Date('2026-09-28T02:00:00.000Z');

function approval(overrides: Partial<PublicApproval> = {}): PublicApproval {
  return {
    id: 'apr-1',
    aiId: 'ai-dev-1',
    groupId: null,
    action: 'Rotate the staging API token',
    summary: 'The staging token leaked in a CI log.',
    details: null,
    argsHash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
    worstCase: { currency: 'EUR', amount: 0.02 },
    requestedBy: 'me@zilar.chat',
    status: 'pending',
    decidedAt: null,
    note: null,
    expiresAt: '2026-09-28T03:00:00.000Z',
    createdAt: '2026-09-28T01:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<ApprovalRule> = {}): ApprovalRule {
  return {
    id: 'rule-1',
    action: 'Rotate the staging API token',
    scope: 'personal',
    groupId: null,
    topicId: null,
    topicName: null,
    createdAt: '2026-09-28T01:30:00.000Z',
    createdBy: 'me',
    ...overrides,
  };
}

describe('expiresInText', () => {
  it('counts seconds, minutes, hours and days down', () => {
    expect(expiresInText('2026-09-28T02:00:45.000Z', NOW)).toBe('in 45 sec');
    expect(expiresInText('2026-09-28T02:12:00.000Z', NOW)).toBe('in 12 min');
    expect(expiresInText('2026-09-28T03:00:00.000Z', NOW)).toBe('in 1 hour');
    expect(expiresInText('2026-09-28T05:00:00.000Z', NOW)).toBe('in 3 hours');
    expect(expiresInText('2026-09-29T02:00:00.000Z', NOW)).toBe('in 1 day');
    expect(expiresInText('2026-09-30T02:00:00.000Z', NOW)).toBe('in 2 days');
  });

  it('reads Expired once the deadline has passed', () => {
    expect(expiresInText('2026-09-28T02:00:00.000Z', NOW)).toBe('Expired');
    expect(expiresInText('2026-09-28T01:00:00.000Z', NOW)).toBe('Expired');
  });
});

describe('worstCaseText', () => {
  it('renders the worst-case line', () => {
    expect(worstCaseText({ currency: 'EUR', amount: 0.02 })).toBe('Worst case: EUR 0.02');
  });

  it('is empty when the action has no money attached', () => {
    expect(worstCaseText(null)).toBe('');
  });
});

describe('decidedAgoText', () => {
  it('reads just now, minutes, hours and days ago', () => {
    expect(decidedAgoText('2026-09-28T02:00:00.000Z', NOW)).toBe('just now');
    expect(decidedAgoText('2026-09-28T01:58:00.000Z', NOW)).toBe('2 min ago');
    expect(decidedAgoText('2026-09-28T01:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(decidedAgoText('2026-09-27T02:00:00.000Z', NOW)).toBe('1 day ago');
  });
});

describe('rowsForList and orderedRows', () => {
  it('builds one row per approval, newest first', () => {
    const older = approval({ id: 'apr-old', createdAt: '2026-09-28T00:00:00.000Z' });
    const newer = approval({ id: 'apr-new', createdAt: '2026-09-28T01:30:00.000Z' });
    const rows = rowsForList([older, newer], {});
    expect(orderedRows(rows).map((row) => row.approval.id)).toEqual(['apr-new', 'apr-old']);
  });

  it('keeps an in-flight decision and its inline error across reloads', () => {
    const first = rowsForList([approval()], {});
    const busy = { ...first, 'apr-1': { ...first['apr-1'], busy: 'deny' as const, error: 'boom' } };
    const reloaded = rowsForList([approval()], busy);
    expect(reloaded['apr-1'].busy).toBe('deny');
    expect(reloaded['apr-1'].error).toBe('boom');
  });

  it('drops rows the server no longer returns', () => {
    const first = rowsForList([approval(), approval({ id: 'apr-2' })], {});
    const reloaded = rowsForList([approval()], first);
    expect(Object.keys(reloaded)).toEqual(['apr-1']);
  });
});

describe('SCREEN_DECISIONS', () => {
  it('offers Approve once, Always and Deny', () => {
    expect(SCREEN_DECISIONS.map((option) => option.decision)).toEqual([
      'approve_once',
      'approve_always',
      'deny',
    ]);
  });
});

describe('decideScreenRow', () => {
  it('returns the decided approval on success', async () => {
    const decided = approval({ status: 'approved_always', decidedAt: '2026-09-28T02:00:00Z' });
    const api = {
      getApproval: async () => approval(),
      decideApproval: async () => decided,
      listApprovals: async () => [],
      listAiApprovalRules: async () => [],
      listGroupApprovalRules: async () => [],
      revokeApprovalRule: async () => {},
    };
    await expect(decideScreenRow(api, 'apr-1', 'approve_always')).resolves.toEqual({
      kind: 'decided',
      approval: decided,
    });
  });

  it('treats a 409 race as gone with the already-decided message', async () => {
    const refreshed = approval({ status: 'approved_once', decidedAt: '2026-09-28T02:00:00Z' });
    const api = {
      getApproval: async () => refreshed,
      decideApproval: async () => {
        throw new ApprovalsApiError(409, 'not_pending', 'already decided');
      },
      listApprovals: async () => [],
      listAiApprovalRules: async () => [],
      listGroupApprovalRules: async () => [],
      revokeApprovalRule: async () => {},
    };
    await expect(decideScreenRow(api, 'apr-1', 'approve_once')).resolves.toEqual({
      kind: 'gone',
      message: 'That request was already decided or expired.',
    });
  });

  it('returns the inline message for any other error', async () => {
    const api = {
      getApproval: async () => approval(),
      decideApproval: async () => {
        throw new ApprovalsApiError(500, 'internal_error', 'boom');
      },
      listApprovals: async () => [],
      listAiApprovalRules: async () => [],
      listGroupApprovalRules: async () => [],
      revokeApprovalRule: async () => {},
    };
    await expect(decideScreenRow(api, 'apr-1', 'deny')).resolves.toEqual({
      kind: 'error',
      message: 'boom',
    });
  });
});

describe('revokeFailedOutcome', () => {
  it('drops the row quietly on a 404 (already revoked elsewhere)', () => {
    expect(
      revokeFailedOutcome(new ApprovalsApiError(404, 'not_found', 'Approval rule not found')),
    ).toEqual({ dropped: true, message: '' });
  });

  it('keeps the row with the message on any other failure', () => {
    expect(revokeFailedOutcome(new ApprovalsApiError(500, 'internal_error', 'boom'))).toEqual({
      dropped: false,
      message: 'boom',
    });
  });
});

describe('groupRulesForScreen', () => {
  it('groups owned rules per AI', () => {
    const owned: OwnedScreenRule[] = [
      { aiId: 'ai-1', rule: rule({ id: 'r-1' }) },
      { aiId: 'ai-2', rule: rule({ id: 'r-2' }) },
      { aiId: 'ai-1', rule: rule({ id: 'r-3' }) },
    ];
    const sections = groupRulesForScreen(owned);
    expect(sections.map((section) => section.aiId)).toEqual(['ai-1', 'ai-2']);
    expect(sections[0].rules.map((item) => item.id)).toEqual(['r-1', 'r-3']);
  });
});
