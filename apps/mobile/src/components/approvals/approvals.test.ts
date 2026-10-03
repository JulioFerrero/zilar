import { describe, expect, it } from 'vitest';

import type { ApprovalRule, PublicApproval } from '@/lib/approvals-api';
import { ApprovalsApiError } from '@/lib/approvals-api';

import { expiresInText, worstCaseText } from './format-relative';
import {
  claimDecision,
  confirmationForDecision,
  decideScreenRow,
  groupRulesForScreen,
  mergeRulesFanOut,
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

describe('claimDecision', () => {
  it('claims an idle id once; a second tap while in flight does nothing', () => {
    const inFlight = new Set<string>();
    expect(claimDecision(inFlight, 'apr-1')).toBe(true);
    expect(claimDecision(inFlight, 'apr-1')).toBe(false);
    inFlight.delete('apr-1');
    expect(claimDecision(inFlight, 'apr-1')).toBe(true);
  });

  it('tracks ids independently', () => {
    const inFlight = new Set<string>();
    expect(claimDecision(inFlight, 'apr-1')).toBe(true);
    expect(claimDecision(inFlight, 'apr-2')).toBe(true);
  });
});

describe('confirmationForDecision', () => {
  it('confirms with a short line per decision', () => {
    expect(confirmationForDecision('approve_once')).toBe('Approved once');
    expect(confirmationForDecision('approve_always')).toBe('Approved always');
    expect(confirmationForDecision('deny')).toBe('Denied');
  });
});

describe('rowsForList and orderedRows', () => {
  it('builds one row per approval, newest first', () => {
    const older = approval({ id: 'apr-old', createdAt: '2026-09-28T00:00:00.000Z' });
    const newer = approval({ id: 'apr-new', createdAt: '2026-09-28T01:30:00.000Z' });
    const rows = rowsForList([older, newer], {});
    expect(orderedRows(rows).map((row) => row.approval.id)).toEqual(['apr-new', 'apr-old']);
  });

  it('keeps an in-flight decision across reloads while its request runs', () => {
    const first = rowsForList([approval()], {});
    const busy = { ...first, 'apr-1': { ...first['apr-1'], busy: 'deny' as const, error: '' } };
    const reloaded = rowsForList([approval()], busy, new Set(['apr-1']));
    expect(reloaded['apr-1'].busy).toBe('deny');
  });

  it('clears a stuck busy on reload when no request is in flight for that id', () => {
    const first = rowsForList([approval()], {});
    const stuck = { ...first, 'apr-1': { ...first['apr-1'], busy: 'deny' as const, error: '' } };
    const reloaded = rowsForList([approval()], stuck, new Set());
    expect(reloaded['apr-1'].busy).toBeNull();
  });

  it('keeps the inline error across reloads so the failure stays visible', () => {
    const first = rowsForList([approval()], {});
    const failed = { ...first, 'apr-1': { ...first['apr-1'], busy: null, error: 'boom' } };
    const reloaded = rowsForList([approval()], failed, new Set());
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

  it('keeps a still-pending row after a 409 race (stale, not decided)', async () => {
    const refreshed = approval({ summary: 'Updated summary.' });
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
      kind: 'stale',
      approval: refreshed,
    });
  });

  it('reports a fixed plain message for any other error, never the raw text', async () => {
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
      message: 'Could not send the decision. Try again.',
    });
  });

  it('a failed decision leaves the row retryable: busy clears, the error shows, a reload keeps it usable and a second tap decides', async () => {
    let calls = 0;
    const decided = approval({ status: 'denied', decidedAt: '2026-09-28T02:00:00Z' });
    const api = {
      getApproval: async () => approval(),
      decideApproval: async () => {
        calls += 1;
        if (calls === 1) {
          throw new ApprovalsApiError(0, 'network_error', 'Could not reach the server');
        }
        return decided;
      },
      listApprovals: async () => [approval()],
      listAiApprovalRules: async () => [],
      listGroupApprovalRules: async () => [],
      revokeApprovalRule: async () => {},
    };
    // First tap: the network fails. The screen clears `busy` and sets the
    // inline error, so the buttons are enabled again with a visible line.
    const first = await decideScreenRow(api, 'apr-1', 'deny');
    expect(first).toEqual({ kind: 'error', message: 'Could not send the decision. Try again.' });
    const failedRows = rowsForList([approval()], {
      'apr-1': {
        approval: approval(),
        busy: null,
        error: (first as { message: string }).message,
      },
    });
    expect(failedRows['apr-1'].busy).toBeNull();
    expect(failedRows['apr-1'].error).toBe('Could not send the decision. Try again.');
    // A later reload (no request in flight) does not bring the busy state
    // back and keeps the error visible.
    const reloaded = rowsForList([approval()], failedRows, new Set());
    expect(reloaded['apr-1'].busy).toBeNull();
    expect(reloaded['apr-1'].error).toBe('Could not send the decision. Try again.');
    // A second tap decides normally.
    await expect(decideScreenRow(api, 'apr-1', 'deny')).resolves.toEqual({
      kind: 'decided',
      approval: decided,
    });
    expect(calls).toBe(2);
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

describe('mergeRulesFanOut', () => {
  const okA = {
    status: 'fulfilled' as const,
    value: { aiId: 'ai-a', rules: [rule({ id: 'r-a' })] },
  };
  const okB = {
    status: 'fulfilled' as const,
    value: { aiId: 'ai-b', rules: [rule({ id: 'r-b' })] },
  };
  const failed404 = {
    status: 'rejected' as const,
    reason: new ApprovalsApiError(404, 'not_found', 'AI not found'),
  };

  it("keeps B's rules when A's rules call answers 404, with no error", () => {
    const merged = mergeRulesFanOut([failed404, okB]);
    expect(merged).toEqual([{ aiId: 'ai-b', rule: rule({ id: 'r-b' }) }]);
  });

  it('merges every AI when all succeed', () => {
    expect(mergeRulesFanOut([okA, okB])).toHaveLength(2);
  });

  it('returns null when every AI fails, so the caller shows the error state', () => {
    expect(mergeRulesFanOut([failed404, failed404])).toBeNull();
  });

  it('returns an empty list (not an error) when no AI has pending requests', () => {
    expect(mergeRulesFanOut([])).toEqual([]);
  });
});
