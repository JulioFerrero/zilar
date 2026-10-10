import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PublicApproval } from '@/lib/approvals-api';

import { AlwaysAllowedRow, RevokeConfirmDialog } from './always-allowed-row';
import { PendingApprovalRow } from './approval-row';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  ShieldAlert: 'ShieldAlert',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', () => ({
  Button: 'Button',
}));

vi.mock('@/lib/depth', () => ({
  primaryKey: {},
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
}));

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

describe('PendingApprovalRow', () => {
  it('shows the AI, summary, worst case, expiry and all three decisions', () => {
    const html = renderToStaticMarkup(
      createElement(PendingApprovalRow, {
        approval: approval(),
        aiName: 'Dev-1',
        now: NOW,
        busy: null,
        actionError: '',
        onDecide: () => {},
      }),
    );
    expect(html).toContain('Rotate the staging API token');
    expect(html).toContain('Dev-1');
    expect(html).toContain('The staging token leaked in a CI log.');
    expect(html).toContain('Worst case: EUR 0.02');
    expect(html).toContain('in 1 hour');
    expect(html).toContain('Approve once');
    expect(html).toContain('Always');
    expect(html).toContain('Deny');
  });

  it('shows the busy label while a decision is in flight', () => {
    const html = renderToStaticMarkup(
      createElement(PendingApprovalRow, {
        approval: approval(),
        aiName: 'Dev-1',
        now: NOW,
        busy: 'approve_always',
        actionError: '',
        onDecide: () => {},
      }),
    );
    expect(html).toContain('Allowing…');
  });

  it('shows the inline error', () => {
    const html = renderToStaticMarkup(
      createElement(PendingApprovalRow, {
        approval: approval(),
        aiName: 'Dev-1',
        now: NOW,
        busy: null,
        actionError: 'boom',
        onDecide: () => {},
      }),
    );
    expect(html).toContain('boom');
  });
});

describe('AlwaysAllowedRow', () => {
  const RULE = {
    id: 'rule-1',
    action: 'Rotate the staging API token',
    scope: 'personal' as const,
    groupId: null,
    topicId: null,
    topicName: null,
    createdAt: '2026-09-28T01:30:00.000Z',
    createdBy: 'me',
  };

  it('shows the action with a Revoke button', () => {
    const html = renderToStaticMarkup(
      createElement(AlwaysAllowedRow, {
        rule: RULE,
        confirming: false,
        revoking: false,
        onAsk: () => {},
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toContain('Rotate the staging API token');
    expect(html).toContain('Revoke');
  });

  it('shows the inline confirm with Revoking while busy', () => {
    const html = renderToStaticMarkup(
      createElement(AlwaysAllowedRow, {
        rule: RULE,
        confirming: true,
        revoking: true,
        onAsk: () => {},
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toContain('Revoking…');
    expect(html).toContain('Cancel');
  });
});

describe('RevokeConfirmDialog', () => {
  const RULE = {
    id: 'rule-1',
    action: 'Rotate the staging API token',
    scope: 'personal' as const,
    groupId: null,
    topicId: null,
    topicName: null,
    createdAt: '2026-09-28T01:30:00.000Z',
    createdBy: 'me',
  };

  it('asks for confirmation before revoking', () => {
    const html = renderToStaticMarkup(
      createElement(RevokeConfirmDialog, {
        rule: RULE,
        busy: false,
        error: '',
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toContain('Stop always allowing');
    expect(html).toContain('Revoke');
    expect(html).toContain('Cancel');
  });

  it('shows the revoke error inline', () => {
    const html = renderToStaticMarkup(
      createElement(RevokeConfirmDialog, {
        rule: RULE,
        busy: false,
        error: 'boom',
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(html).toContain('boom');
  });
});
