import { describe, expect, it, vi } from 'vitest';

import {
  CreatedInviteLinkView,
  describeInviteLink,
  InviteLinkRow,
  inviteLinkState,
  validateInviteLinkForm,
} from './invite-links-sheet';
import type { GroupInviteLink } from '@/lib/invite-links-api';

// The mobile app has no React Native testing library, so the hook-free views
// (`InviteLinkRow`, `CreatedInviteLinkView`) are called as plain functions
// with `react-native` stubbed — the same pattern as
// `markdown-text.test.tsx`. This keeps the tests in Node (no simulator, no
// new dependency) while exercising the real render output.
vi.mock('react-native', () => ({
  Keyboard: { addListener: vi.fn(() => ({ remove: vi.fn() })) },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Share: { share: vi.fn() },
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('../../lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; style?: unknown; onPress?: () => void; [key: string]: unknown };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function link(overrides: Partial<GroupInviteLink> = {}): GroupInviteLink {
  return {
    id: 'link-1',
    label: 'Friends',
    tokenHint: 'abcd',
    uses: 2,
    maxUses: 10,
    expiresAt: null,
    revoked: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('inviteLinkState', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');

  it('is active for a usable link', () => {
    expect(inviteLinkState(link(), now)).toBe('active');
  });

  it('is revoked, expired or exhausted', () => {
    expect(inviteLinkState(link({ revoked: true }), now)).toBe('revoked');
    expect(inviteLinkState(link({ expiresAt: '2026-09-29T12:00:00.000Z' }), now)).toBe('expired');
    expect(inviteLinkState(link({ uses: 10 }), now)).toBe('exhausted');
  });

  it('describes the link like the web list', () => {
    expect(describeInviteLink(link(), now)).toContain('Friends');
    expect(describeInviteLink(link(), now)).toContain('2/10 uses');
    expect(describeInviteLink(link(), now)).toContain('never expires');
    expect(describeInviteLink(link({ label: null }), now)).toContain('····abcd');
    expect(describeInviteLink(link({ uses: 10 }), now)).toContain('exhausted');
  });
});

describe('validateInviteLinkForm', () => {
  it('accepts an empty form and trims the label', () => {
    expect(validateInviteLinkForm({ label: '', expiry: '', maxUses: '' })).toEqual({ input: {} });
    expect(validateInviteLinkForm({ label: '  Friends  ', expiry: '48', maxUses: '10' })).toEqual({
      input: { label: 'Friends', expiresInHours: 48, maxUses: 10 },
    });
  });

  it('rejects out-of-range values with the web messages', () => {
    expect(validateInviteLinkForm({ label: 'x'.repeat(61), expiry: '', maxUses: '' })).toEqual({
      error: 'The label must be at most 60 characters.',
    });
    expect(validateInviteLinkForm({ label: '', expiry: '0', maxUses: '' })).toEqual({
      error: 'Expiry must be 1 to 8760 hours.',
    });
    expect(validateInviteLinkForm({ label: '', expiry: '8761', maxUses: '' })).toEqual({
      error: 'Expiry must be 1 to 8760 hours.',
    });
    expect(validateInviteLinkForm({ label: '', expiry: '', maxUses: '10001' })).toEqual({
      error: 'Max uses must be 1 to 10000.',
    });
    expect(validateInviteLinkForm({ label: '', expiry: 'soon', maxUses: '' })).toEqual({
      error: 'Expiry must be 1 to 8760 hours.',
    });
  });
});

const NOW = Date.parse('2026-09-30T12:00:00.000Z');

describe('InviteLinkRow', () => {
  function row(link_: Parameters<typeof InviteLinkRow>[0]['link'], now: number) {
    return InviteLinkRow({ link: link_, now, revoking: false, onRevoke: () => {} });
  }

  it('renders the name, the uses line and a Revoke button for an active link', () => {
    const elements = collect(row(link(), NOW));
    const all = textOf(elements);
    expect(all).toContain('Friends');
    expect(all).toContain('2/10 uses');
    expect(all).toContain('Revoke');
    const revokes = elements.filter(
      (element) => element.props.accessibilityLabel === 'Revoke invite link Friends',
    );
    expect(revokes).toHaveLength(1);
  });

  it('renders against the passed timestamp, so a per-open `now` never goes stale', () => {
    // The regression: the sheet froze the clock at first mount, so a link
    // that expired afterwards kept reading "active". The screen now passes a
    // fresh `now` on every open; rows rendered with the fresh stamp flip to
    // expired while the stale stamp still says active.
    const expiring = link({ expiresAt: '2026-09-30T13:00:00.000Z' });
    const stale = textOf(collect(row(expiring, Date.parse('2026-09-30T12:00:00.000Z'))));
    expect(stale).not.toContain('expired');
    const fresh = textOf(collect(row(expiring, Date.parse('2026-09-30T14:00:00.000Z'))));
    expect(fresh).toContain('expired');
  });

  it('shows a revoked label and no button for a revoked link', () => {
    const elements = collect(row(link({ revoked: true }), NOW));
    expect(textOf(elements)).toContain('revoked');
    expect(
      elements.filter(
        (element) => element.props.accessibilityLabel === 'Revoke invite link Friends',
      ),
    ).toHaveLength(0);
  });

  it('carries only the last-4 hint, never the full token', () => {
    const elements = collect(row(link({ label: null }), NOW));
    expect(textOf(elements)).toContain('····abcd');
    expect(textOf(elements)).not.toContain('a'.repeat(64));
  });

  it('revokes on press with the link id', () => {
    const revoked: string[] = [];
    const elements = collect(
      InviteLinkRow({
        link: link(),
        now: NOW,
        revoking: false,
        onRevoke: (id) => revoked.push(id),
      }),
    );
    const button = elements.find(
      (element) => element.props.accessibilityLabel === 'Revoke invite link Friends',
    );
    expect(button).toBeDefined();
    const onPress = (button as TestElement).props.onPress;
    expect(typeof onPress).toBe('function');
    (onPress as () => void)();
    expect(revoked).toEqual(['link-1']);
  });
});

describe('CreatedInviteLinkView', () => {
  const url = 'zilar://join/' + 'a'.repeat(64);

  it('shows the URL once with Copy, Share and the warning', () => {
    const elements = collect(
      CreatedInviteLinkView({
        url,
        copied: false,
        onCopy: () => {},
        onShare: () => {},
        onDone: () => {},
      }),
    );
    const all = textOf(elements);
    expect(all).toContain(url);
    expect(all).toContain('Copy');
    expect(all).toContain('Share');
    expect(all).toContain('shown once');
  });

  it('wires Copy, Share and Done', () => {
    const calls: string[] = [];
    const elements = collect(
      CreatedInviteLinkView({
        url,
        copied: true,
        onCopy: () => calls.push('copy'),
        onShare: () => calls.push('share'),
        onDone: () => calls.push('done'),
      }),
    );
    expect(textOf(elements)).toContain('Copied');
    for (const label of ['Copy invite link', 'Share invite link', 'Done with invite link']) {
      const pressed = elements.find((element) => element.props.accessibilityLabel === label);
      expect(pressed).toBeDefined();
      const onPress = (pressed as TestElement).props.onPress;
      expect(typeof onPress).toBe('function');
      (onPress as () => void)();
    }
    expect(calls).toEqual(['copy', 'share', 'done']);
  });
});
