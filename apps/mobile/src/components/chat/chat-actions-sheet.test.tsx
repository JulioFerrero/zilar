import { describe, expect, it, vi } from 'vitest';

import type { ChatSummary } from '@zilar/chat-core';

import { ChatActionsSheet } from './chat-actions-sheet';

// The mobile app has no React Native testing library, so the component is
// rendered to a plain element tree with `react-native` stubbed (the
// `markdown-text.test.tsx` pattern). This keeps the test in Node (no
// simulator, no new dependency) while still exercising the real component.
vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('../ui/text', () => ({
  Text: 'Text',
}));

vi.mock('../../lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

vi.mock('lucide-react-native', () => ({
  Archive: 'Archive',
  Bell: 'Bell',
  BellOff: 'BellOff',
  Pin: 'Pin',
  PinOff: 'PinOff',
}));

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress?: () => void;
    visible?: boolean;
  };
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

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'ana',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function labels(elements: TestElement[]): (string | undefined)[] {
  return elements
    .filter((element) => element.type === 'Pressable')
    .map((element) => element.props.accessibilityLabel);
}

const BASE = {
  busy: false,
  error: '',
  muteOpen: false,
  onOpenMute: () => {},
  onMute: () => {},
  onUnmute: () => {},
  onTogglePin: () => {},
  onToggleArchive: () => {},
  onClose: () => {},
};

describe('ChatActionsSheet', () => {
  it('renders Pin, Mute and Archive for a plain chat', () => {
    const elements = collect(ChatActionsSheet({ ...BASE, chat: chat() }));
    expect(labels(elements)).toEqual(
      expect.arrayContaining(['Pin chat', 'Mute chat', 'Archive chat']),
    );
  });

  it('renders Unpin, muted and Unarchive states', () => {
    const elements = collect(
      ChatActionsSheet({
        ...BASE,
        chat: chat({ muted: true, archived: true, pinnedAt: new Date() }),
      }),
    );
    expect(labels(elements)).toEqual(
      expect.arrayContaining(['Unpin chat', 'Change mute', 'Unarchive chat']),
    );
  });

  it('opens the mute submenu with every duration and Unmute when muted', () => {
    const closed = collect(ChatActionsSheet({ ...BASE, chat: chat() }));
    expect(labels(closed)).not.toContain('Mute for 1 hour');

    const open = collect(ChatActionsSheet({ ...BASE, chat: chat(), muteOpen: true }));
    expect(labels(open)).toEqual(
      expect.arrayContaining([
        'Mute for 1 hour',
        'Mute for 8 hours',
        'Mute for 1 day',
        'Mute for 1 week',
        'Mute for forever',
      ]),
    );
    expect(labels(open)).not.toContain('Unmute chat');

    const muted = collect(
      ChatActionsSheet({ ...BASE, chat: chat({ muted: true }), muteOpen: true }),
    );
    expect(labels(muted)).toContain('Unmute chat');
  });

  it('calls onMute with the duration id', () => {
    const seen: string[] = [];
    const elements = collect(
      ChatActionsSheet({ ...BASE, chat: chat(), muteOpen: true, onMute: (id) => seen.push(id) }),
    );
    const week = elements.find((element) => element.props.accessibilityLabel === 'Mute for 1 week');
    week?.props.onPress?.();
    expect(seen).toEqual(['week']);
  });

  it('shows the group title for a group row and the save error', () => {
    const general = chat({
      id: 'general@g',
      title: 'General',
      kind: 'group',
      groupId: 'g1',
      groupTitle: 'Dev team',
    });
    const elements = collect(
      ChatActionsSheet({
        ...BASE,
        chat: general,
        groupTitle: 'Dev team',
        error: 'Could not save.',
      }),
    );
    expect(textOf(elements)).toContain('Dev team');
    expect(textOf(elements)).toContain('Could not save.');
  });

  it('disables the rows while the General row has not arrived yet', () => {
    // A group without a General row (older servers) shows the group title
    // from the entry, but no row is actionable: there is no single row a
    // group-level pref could sit on.
    const elements = collect(ChatActionsSheet({ ...BASE, chat: null, groupTitle: 'Dev team' }));
    const modal = elements.find((element) => element.type === 'Modal');
    expect(modal?.props).toMatchObject({ visible: true });
    expect(textOf(elements)).toContain('Dev team');
    const rows = elements.filter(
      (element) =>
        element.type === 'Pressable' &&
        element.props.accessibilityLabel !== undefined &&
        element.props.accessibilityLabel !== 'Close chat actions',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.props.disabled).toBe(true);
    }
  });

  it('keeps pin/mute/archive disabled without a General row, Open group enabled', () => {
    // T-0139 should-fix: a group whose General row is absent (older server,
    // or General archived/filtered out) must not write a group pref onto a
    // non-General topic JID. The sheet still titles itself from the group
    // and opens the group screen, but the pref rows stay disabled.
    const seen: string[] = [];
    const elements = collect(
      ChatActionsSheet({
        ...BASE,
        chat: null,
        groupTitle: 'Dev team',
        groupId: 'g1',
        onOpenGroup: (id) => seen.push(id),
      }),
    );
    const byLabel = (label: string) =>
      elements.find((element) => element.props.accessibilityLabel === label);
    expect(byLabel('Pin chat')?.props.disabled).toBe(true);
    expect(byLabel('Mute chat')?.props.disabled).toBe(true);
    expect(byLabel('Archive chat')?.props.disabled).toBe(true);
    const open = byLabel('Open group');
    expect(open?.props.disabled).toBe(false);
    open?.props.onPress?.();
    expect(seen).toEqual(['g1']);
  });

  it('shows Open group for a group row and calls onOpenGroup with the id', () => {
    // T-0139: the long-press sheet is the chat list's way to the group
    // screen (invite links, roles, members), including a General-only
    // group. Unlike pin/mute/archive, opening needs no General row, so it
    // stays enabled while those wait for it.
    const seen: string[] = [];
    const general = chat({
      id: 'general@g',
      title: 'General',
      kind: 'group',
      groupId: 'g1',
      groupTitle: 'Dev team',
    });
    const elements = collect(
      ChatActionsSheet({
        ...BASE,
        chat: general,
        groupTitle: 'Dev team',
        groupId: 'g1',
        onOpenGroup: (id) => seen.push(id),
      }),
    );
    const open = elements.find((element) => element.props.accessibilityLabel === 'Open group');
    expect(open).toBeDefined();
    expect(open?.props.disabled).toBe(false);
    open?.props.onPress?.();
    expect(seen).toEqual(['g1']);
  });

  it('hides Open group for a plain chat', () => {
    const elements = collect(ChatActionsSheet({ ...BASE, chat: chat() }));
    expect(labels(elements)).not.toContain('Open group');
  });

  it('renders a hidden modal when closed', () => {
    const elements = collect(ChatActionsSheet({ ...BASE, chat: null }));
    const modal = elements.find((element) => element.type === 'Modal');
    expect(modal?.props).toMatchObject({ visible: false });
  });
});
