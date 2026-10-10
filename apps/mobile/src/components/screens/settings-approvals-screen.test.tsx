import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ApprovalRule, PublicApproval } from '@/lib/approvals-api';

// Settings → Approvals. The body keeps its own state, forced through the
// `useState` mock in call order: pending rows, the load status, the load error,
// the notice, the clock, AI names, owned rules, the rules status and error, the
// rule being revoked, the revoking flag, the revoke error and refreshing. Every
// setter call is recorded in `setCalls`. The Retry, row decision and revoke
// handlers are captured while rendering.
const NONE = Symbol('none');
const STATE_COUNT = 13;

vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('react-native', () => ({
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  ShieldCheck: 'ShieldCheck',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ais/screen-shell', () => ({
  AisScreenShell: ({ title, children }: { title: string; children: React.ReactNode }) =>
    createElement('AisScreenShell', null, title, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => createElement('Button', null, children),
}));

vi.mock('@/components/ui/state-message', () => ({
  StateMessage: ({
    title,
    action,
  }: {
    title: string;
    action?: { label: string; onPress: () => void };
  }) => {
    if (action !== undefined) {
      handlers[action.label] = action.onPress;
    }
    return createElement('StateMessage', null, title);
  },
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/components/approvals/approval-row', () => ({
  PendingApprovalRow: ({
    approval,
    aiName,
    onDecide,
  }: {
    approval: PublicApproval;
    aiName: string;
    onDecide: (id: string, decision: string) => void;
  }) => {
    decideRow = onDecide;
    return createElement('PendingApprovalRow', null, aiName, approval.summary);
  },
}));

vi.mock('@/components/approvals/always-allowed-row', () => ({
  AlwaysAllowedRow: ({ rule, onAsk }: { rule: ApprovalRule; onAsk: () => void }) => {
    handlers[`ask:${rule.id}`] = onAsk;
    return createElement('AlwaysAllowedRow', null, rule.action);
  },
  RevokeConfirmDialog: ({
    rule,
    error,
    onConfirm,
  }: {
    rule: ApprovalRule | null;
    error: string;
    onConfirm: () => void;
  }) => {
    handlers.confirmRevoke = onConfirm;
    return createElement('RevokeConfirmDialog', null, rule?.action ?? '', error);
  },
}));

vi.mock('@/lib/ais-api', () => ({
  createAisApi: () => ({ listAis: async () => [] }),
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: '#ededed',
  MUTED_FOREGROUND: '#a1a1a1',
}));

const api = {
  listApprovals: vi.fn(async (): Promise<PublicApproval[]> => []),
  listAiApprovalRules: vi.fn(async (): Promise<ApprovalRule[]> => []),
  revokeApprovalRule: vi.fn(async (_id: string): Promise<void> => {}),
  decideApproval: vi.fn(async (_id: string, _decision: string): Promise<PublicApproval> => {
    throw new Error('not used');
  }),
};

vi.mock('@/components/chat/use-approvals-api', () => ({
  useApprovalsApi: () => ({ api }),
}));

let handlers: Record<string, () => void> = {};
let decideRow: ((id: string, decision: string) => void) | undefined;
let forced: unknown[] = [];
let cursor = 0;
let setCalls: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      const index = cursor;
      cursor += 1;
      const value = index < forced.length && forced[index] !== NONE ? forced[index] : initial;
      return [
        value as T,
        ((next: unknown) => {
          setCalls.push(next);
        }) as Dispatch<SetStateAction<T>>,
      ];
    },
  };
});

const APPROVAL: PublicApproval = {
  id: 'a1',
  aiId: 'ai-1',
  groupId: null,
  action: 'send_email',
  summary: 'Send the invoice',
  details: null,
  argsHash: 'hash',
  worstCase: null,
  requestedBy: 'helper',
  status: 'pending',
  decidedAt: null,
  note: null,
  expiresAt: '2026-10-10T12:00:00.000Z',
  createdAt: '2026-10-09T10:00:00.000Z',
};

const RULE: ApprovalRule = {
  id: 'r1',
  action: 'read_calendar',
  scope: 'personal',
  groupId: null,
  topicId: null,
  topicName: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  createdBy: 'me',
};

const REVOKE_FAILED = 'Could not revoke the rule.';

async function renderScreen(input: {
  rows?: Record<string, { approval: PublicApproval; busy: null; error: string }>;
  status?: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  notice?: string;
  aiNames?: Record<string, string>;
  rules?: Array<{ aiId: string; rule: ApprovalRule }>;
  rulesStatus?: 'loading' | 'ready' | 'error';
  rulesError?: string;
  confirmRule?: { aiId: string; rule: ApprovalRule } | null;
}): Promise<string> {
  forced = Array.from({ length: STATE_COUNT }, () => NONE);
  forced[0] = input.rows ?? {};
  forced[1] = input.status ?? 'loading';
  forced[2] = input.errorMessage ?? '';
  forced[3] = input.notice ?? '';
  // The clock: a fixed time, so the countdown does not depend on when tests run.
  forced[4] = new Date('2026-10-09T12:00:00.000Z');
  forced[5] = input.aiNames ?? {};
  forced[6] = input.rules ?? [];
  forced[7] = input.rulesStatus ?? 'loading';
  forced[8] = input.rulesError ?? '';
  forced[9] = input.confirmRule ?? null;
  cursor = 0;
  setCalls = [];
  handlers = {};
  decideRow = undefined;
  try {
    const module = await import('@/app/settings/approvals');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forced = [];
  }
}

// Lets the press handler's promise chain and any Effect run finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApprovalsScreen', () => {
  it('shows loading while the list loads, without the rules section', async () => {
    const html = await renderScreen({ status: 'loading' });
    expect(html).toContain('Approvals');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Always allowed');
  });

  it('shows the empty pending and rules states', async () => {
    const html = await renderScreen({ status: 'ready', rulesStatus: 'ready' });
    expect(html).toContain('Nothing is waiting for you.');
    expect(html).toContain('Nothing is always allowed here.');
  });

  it('lists a pending request under its AI name', async () => {
    const html = await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      rows: { a1: { approval: APPROVAL, busy: null, error: '' } },
      aiNames: { 'ai-1': 'Helper' },
    });
    expect(html).toContain('Helper');
    expect(html).toContain('Send the invoice');
  });

  it('shows the confirmation notice after a decision', async () => {
    const html = await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      notice: 'Approved once',
    });
    expect(html).toContain('Approved once');
  });

  it('shows the load error with Retry', async () => {
    const html = await renderScreen({
      status: 'error',
      errorMessage: 'Could not load approvals.',
    });
    expect(html).toContain('Could not load approvals.');
    expect(handlers.Retry).toBeDefined();
  });

  it('shows the rules error', async () => {
    const html = await renderScreen({
      status: 'ready',
      rulesStatus: 'error',
      rulesError: 'Could not load the rules.',
    });
    expect(html).toContain('Could not load the rules.');
  });

  it('lists the always-allowed rules under their AI name', async () => {
    const html = await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      aiNames: { 'ai-1': 'Helper' },
      rules: [{ aiId: 'ai-1', rule: RULE }],
    });
    expect(html).toContain('Helper');
    expect(html).toContain('read_calendar');
    expect(handlers['ask:r1']).toBeDefined();
  });

  it('shows the revoke dialog for the rule being revoked', async () => {
    const html = await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      rules: [{ aiId: 'ai-1', rule: RULE }],
      confirmRule: { aiId: 'ai-1', rule: RULE },
    });
    expect(html).toContain('RevokeConfirmDialog');
    expect(handlers.confirmRevoke).toBeDefined();
  });

  it('Retry reloads the approvals', async () => {
    api.listApprovals.mockClear();
    await renderScreen({ status: 'error', errorMessage: 'Could not load approvals.' });
    handlers.Retry?.();
    await flush();
    expect(api.listApprovals).toHaveBeenCalled();
  });

  it('a decision sends the decision for that row', async () => {
    api.decideApproval.mockClear();
    api.decideApproval.mockResolvedValueOnce(APPROVAL);
    await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      rows: { a1: { approval: APPROVAL, busy: null, error: '' } },
    });
    decideRow?.('a1', 'approve_once');
    await flush();
    expect(api.decideApproval.mock.calls[0]?.[0]).toBe('a1');
    expect(api.decideApproval.mock.calls[0]?.[1]).toBe('approve_once');
  });

  it('confirming a revoke calls the API and drops the rule', async () => {
    api.revokeApprovalRule.mockClear();
    api.revokeApprovalRule.mockResolvedValueOnce(undefined);
    await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      rules: [{ aiId: 'ai-1', rule: RULE }],
      confirmRule: { aiId: 'ai-1', rule: RULE },
    });
    handlers.confirmRevoke?.();
    await flush();
    expect(api.revokeApprovalRule).toHaveBeenCalledWith('r1');
    const updater = setCalls.find((next) => typeof next === 'function') as
      ((rules: Array<{ aiId: string; rule: ApprovalRule }>) => unknown[]) | undefined;
    expect(updater?.([{ aiId: 'ai-1', rule: RULE }])).toEqual([]);
  });

  it('a failed revoke shows the fixed sentence', async () => {
    api.revokeApprovalRule.mockClear();
    api.revokeApprovalRule.mockRejectedValueOnce('not an error object');
    await renderScreen({
      status: 'ready',
      rulesStatus: 'ready',
      rules: [{ aiId: 'ai-1', rule: RULE }],
      confirmRule: { aiId: 'ai-1', rule: RULE },
    });
    handlers.confirmRevoke?.();
    await flush();
    expect(api.revokeApprovalRule).toHaveBeenCalledWith('r1');
    expect(setCalls).toContain(REVOKE_FAILED);
  });
});
