import { describe, expect, it, vi } from 'vitest';

import type { ChatSummary } from '@galena/chat-core';

import { TopicActionsSheet, type TopicPrefAction } from './topic-sheets';

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

vi.mock('./avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('lucide-react-native', () => ({
  Lock: 'Lock',
}));

interface TestElement {
  type: unknown;
  props: { children?: unknown; accessibilityLabel?: string; onPress?: () => void };
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

function topicChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 't-devteam-bug',
    title: 'Checkout bug',
    kind: 'group',
    isAI: false,
    space: 'work',
    unread: 0,
    muted: false,
    groupId: 'g-devteam',
    groupTitle: 'Dev team',
    topic: {
      id: 't-devteam-bug',
      glyph: 'B',
      kind: 'bug',
      status: 'in_progress',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  };
}

function labels(elements: TestElement[]): (string | undefined)[] {
  return elements
    .filter((element) => element.type === 'Pressable')
    .map((element) => element.props.accessibilityLabel);
}

const BASE = {
  canArchive: false,
  muteOpen: false,
  onOpenMute: () => {},
  onAction: () => {},
  onPref: () => {},
  onClose: () => {},
};

describe('TopicActionsSheet', () => {
  it('renders Pin, Mute and Archive chat, never the manager archive for a member', () => {
    const elements = collect(TopicActionsSheet({ ...BASE, chat: topicChat() }));
    expect(labels(elements)).toEqual(
      expect.arrayContaining(['Pin topic', 'Mute topic', 'Archive chat']),
    );
    expect(labels(elements)).not.toContain('Archive topic for everyone');
  });

  it('renders the manager archive separately from the per-user one', () => {
    const elements = collect(TopicActionsSheet({ ...BASE, chat: topicChat(), canArchive: true }));
    expect(labels(elements)).toEqual(
      expect.arrayContaining(['Archive chat', 'Archive topic for everyone']),
    );
  });

  it('opens the mute submenu with every duration and Unmute when muted', () => {
    const open = collect(TopicActionsSheet({ ...BASE, chat: topicChat(), muteOpen: true }));
    expect(labels(open)).toEqual(
      expect.arrayContaining([
        'Mute for 1 hour',
        'Mute for 8 hours',
        'Mute for 1 day',
        'Mute for 1 week',
        'Mute for forever',
      ]),
    );

    const muted = collect(
      TopicActionsSheet({ ...BASE, chat: topicChat({ muted: true }), muteOpen: true }),
    );
    expect(labels(muted)).toContain('Unmute topic');
  });

  it('sends pin, unmute and per-user archive through onPref, the manager one through onAction', () => {
    const prefs: TopicPrefAction[] = [];
    const actions: string[] = [];
    const elements = collect(
      TopicActionsSheet({
        ...BASE,
        chat: topicChat({ archived: true, pinnedAt: new Date() }),
        canArchive: true,
        onPref: (action) => prefs.push(action),
        onAction: (action) => actions.push(action),
      }),
    );
    elements
      .find((element) => element.props.accessibilityLabel === 'Unpin topic')
      ?.props.onPress?.();
    elements
      .find((element) => element.props.accessibilityLabel === 'Unarchive chat')
      ?.props.onPress?.();
    elements
      .find((element) => element.props.accessibilityLabel === 'Archive topic for everyone')
      ?.props.onPress?.();
    expect(prefs).toEqual([
      { kind: 'pin', pinned: false },
      { kind: 'archive', archived: false },
    ]);
    expect(actions).toEqual(['archive']);
  });
});
