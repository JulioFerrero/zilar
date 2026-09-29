import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '@galena/protocol';

import { ApprovalsApiError, type ApprovalsApi, type PublicApproval } from '../../lib/approvals-api';

import { applyDecision, approvalStatusLabel, loadApprovalCardState } from './approval-card';

// `react-native` ships Flow-typed source, which Vitest's parser rejects, so we
// stub the surface `approval-card.tsx` actually pulls in. Mocks are declared
// before any import so they apply to the production module graph.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { select: <T,>(value: { default: T }): T => value.default },
}));

vi.mock('../ui/button', () => ({ Button: 'Pressable' }));
vi.mock('../ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: ({ children }: { children: unknown }) => children },
}));
vi.mock('../ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));
vi.mock('./use-approvals-api', () => ({
  useApprovalsApi: () => ({ api: null, mock: false }),
}));

// The mobile test suite does not mount React (no React testing library, no
// `react-test-renderer`): `markdown-text.test.tsx` and `reaction-chips.test.tsx`
// render components as plain functions to inspect the JSX, and there is no
// hook-driven render path. `ApprovalCard` uses `useState` / `useEffect` /
// `useCallback`, so this file exercises the state logic through the helpers
// the component itself uses (`loadApprovalCardState`, `applyDecision`,
// `approvalStatusLabel`). The component just wires these helpers to the UI.

const REQUEST: ApprovalRequest = {
  id: 'apr-1',
  room: 'dev-ai@galena.chat',
  ai: 'dev-ai@galena.chat',
  action: 'Rotate the staging API token',
  summary: 'The staging token leaked in a CI log.',
  details: 'Rotate and update the CI secret.',
  args_hash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
  worst_case_cost: { currency: 'EUR', amount: 0.02 },
  requested_by: 'me@galena.chat',
  expires_at: '2026-09-28T03:00:00.000Z',
};

const NOW = '2026-09-28T02:00:00.000Z';

const PENDING: PublicApproval = {
  id: 'apr-1',
  aiId: 'ai-dev-1',
  groupId: null,
  action: 'Rotate the staging API token',
  summary: 'The staging token leaked in a CI log.',
  details: 'Rotate and update the CI secret.',
  argsHash: '8f14e45fceea167a5a36dedd4bea2543c9f4d5a7b0c1e2d3f4a5b6c7d8e9f0a1',
  worstCase: { currency: 'EUR', amount: 0.02 },
  requestedBy: 'me@galena.chat',
  status: 'pending',
  decidedAt: null,
  note: null,
  expiresAt: '2026-09-28T03:00:00.000Z',
  createdAt: '2026-09-28T01:00:00.000Z',
};

function buildApi(overrides: Partial<ApprovalsApi> = {}): ApprovalsApi {
  const getApproval =
    overrides.getApproval ??
    (async (id) => {
      if (id !== REQUEST.id) {
        throw new ApprovalsApiError(404, 'not_found', 'Approval not found');
      }
      return PENDING;
    });
  const decideApproval = overrides.decideApproval ?? (async () => PENDING);
  return { getApproval, decideApproval };
}

describe('approvalStatusLabel', () => {
  it('returns Approved for approved_once', () => {
    expect(approvalStatusLabel({ ...PENDING, status: 'approved_once', decidedAt: NOW })).toBe(
      'Approved',
    );
  });

  it('returns Approved for approved_always (always allow is server-side only)', () => {
    expect(approvalStatusLabel({ ...PENDING, status: 'approved_always', decidedAt: NOW })).toBe(
      'Approved',
    );
  });

  it('returns Denied, Expired and Already used for the other terminal states', () => {
    expect(approvalStatusLabel({ ...PENDING, status: 'denied', decidedAt: NOW })).toBe('Denied');
    expect(approvalStatusLabel({ ...PENDING, status: 'expired', decidedAt: NOW })).toBe('Expired');
    expect(approvalStatusLabel({ ...PENDING, status: 'consumed', decidedAt: NOW })).toBe(
      'Already used',
    );
  });

  it('returns Pending for a row that is still pending', () => {
    expect(approvalStatusLabel(PENDING)).toBe('Pending');
  });
});

describe('loadApprovalCardState', () => {
  it('returns the approval when the api finds it', async () => {
    const api = buildApi();
    await expect(loadApprovalCardState(api, REQUEST.id)).resolves.toEqual({
      kind: 'ready',
      approval: PENDING,
    });
  });

  it('returns notDecidable on a 404 (the viewer may not decide it)', async () => {
    const api = buildApi();
    await expect(loadApprovalCardState(api, 'apr-missing')).resolves.toEqual({
      kind: 'notDecidable',
    });
  });

  it('returns error on any non-404 failure (so the card can show Retry)', async () => {
    const api = buildApi({
      getApproval: async () => {
        throw new ApprovalsApiError(500, 'internal_error', 'boom');
      },
    });
    await expect(loadApprovalCardState(api, REQUEST.id)).resolves.toEqual({ kind: 'error' });
  });

  it('returns error on a network failure', async () => {
    const api = buildApi({
      getApproval: async () => {
        throw new ApprovalsApiError(0, 'network_error', 'offline');
      },
    });
    await expect(loadApprovalCardState(api, REQUEST.id)).resolves.toEqual({ kind: 'error' });
  });
});

describe('applyDecision', () => {
  it('returns the decided approval on success', async () => {
    const decided: PublicApproval = { ...PENDING, status: 'approved_once', decidedAt: NOW };
    const api = buildApi({
      decideApproval: async () => decided,
    });
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result).toEqual({ kind: 'ready', approval: decided });
  });

  it('sends approve_once for Approve and deny for Deny', async () => {
    const spy = vi.fn<(decision: string) => Promise<PublicApproval>>(async () => PENDING);
    const api = buildApi({
      decideApproval: async (_id, decision) => spy(decision),
    });
    await applyDecision(api, REQUEST.id, 'approve_once');
    expect(spy).toHaveBeenCalledWith('approve_once');
    await applyDecision(api, REQUEST.id, 'deny');
    expect(spy).toHaveBeenLastCalledWith('deny');
  });

  it('treats a 409 not_pending as a reload (returns the fresh row)', async () => {
    const refreshed: PublicApproval = { ...PENDING, status: 'approved_once', decidedAt: NOW };
    const api: ApprovalsApi = {
      getApproval: async () => refreshed,
      decideApproval: async () => {
        throw new ApprovalsApiError(409, 'not_pending', 'already decided');
      },
    };
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result).toEqual({ kind: 'reloaded', approval: refreshed });
  });

  it('treats a 409 expired as a reload (returns the fresh row)', async () => {
    const refreshed: PublicApproval = { ...PENDING, status: 'expired', decidedAt: NOW };
    const api: ApprovalsApi = {
      getApproval: async () => refreshed,
      decideApproval: async () => {
        throw new ApprovalsApiError(409, 'expired', 'expired');
      },
    };
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result).toEqual({ kind: 'reloaded', approval: refreshed });
  });

  it('returns null from the reload when getApproval after a 409 also fails', async () => {
    const api: ApprovalsApi = {
      getApproval: async () => {
        throw new ApprovalsApiError(500, 'internal_error', 'boom');
      },
      decideApproval: async () => {
        throw new ApprovalsApiError(409, 'not_pending', 'already decided');
      },
    };
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result).toEqual({ kind: 'reloaded', approval: null });
  });

  it('returns the message for any other error so the card shows it inline', async () => {
    const api = buildApi({
      decideApproval: async () => {
        throw new ApprovalsApiError(500, 'internal_error', 'boom');
      },
    });
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result).toEqual({ kind: 'error', message: 'boom' });
  });

  it('falls back to a generic message for a non-ApprovalsApiError throw', async () => {
    const api = buildApi({
      decideApproval: async () => {
        throw new Error('plain');
      },
    });
    const result = await applyDecision(api, REQUEST.id, 'approve_once');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('plain');
    }
  });
});
