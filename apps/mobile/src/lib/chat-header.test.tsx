import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/chat/chat-header';
import type { ChatSummary } from './types';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('../components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('../components/ui/icon-button', () => ({
  IconButton: ({
    label,
    children,
    onPress,
  }: {
    label: string;
    children?: unknown;
    onPress?: unknown;
  }) => ({
    type: 'IconButton',
    props: { accessibilityLabel: label, children, onPress },
  }),
}));

vi.mock('../components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('../components/chat/ai-badge', () => ({
  AiBadge: 'AiBadge',
}));

vi.mock('../components/chat/typing-dots', () => ({
  TypingDots: 'TypingDots',
}));

vi.mock('../store/chat-store-provider', () => ({
  useChatStore: () => undefined,
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Lock: 'Lock',
  MoreVertical: 'MoreVertical',
  Search: 'Search',
}));

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    accessibilityLabel?: string;
    onPress?: unknown;
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

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'ana@galena.test',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function topicChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return chat({
    id: 't-1@rooms.galena.test',
    title: 'Checkout bug',
    kind: 'group',
    groupId: 'g1',
    groupTitle: 'Dev team',
    topic: {
      id: 't-1',
      glyph: 'B',
      kind: 'bug',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  });
}

function buttonsFor(node: unknown): TestElement[] {
  return collect(node).filter(
    (element) => element.type === 'Pressable' || element.type === 'IconButton',
  );
}

function labels(elements: TestElement[]): (string | undefined)[] {
  return elements.map((element) => element.props.accessibilityLabel);
}

describe('ChatHeader buttons (T-0139)', () => {
  it('topics keep the info title tap, the scoped search and the menu', () => {
    const elements = buttonsFor(
      ChatHeader({
        chat: topicChat(),
        onBack: () => {},
        onSearchInChat: () => {},
        topicGroupName: 'Dev team',
        onOpenInfo: () => {},
      }),
    );
    expect(labels(elements)).toContain('Topic info for Checkout bug');
    expect(labels(elements)).toContain('Search in chat');
    expect(labels(elements)).toContain('More options');
    for (const element of elements) {
      expect(element.props.onPress).not.toBeUndefined();
    }
  });

  it('has no dead menu or dead search in a DM: missing wiring hides the button', () => {
    const elements = buttonsFor(ChatHeader({ chat: chat(), onBack: () => {} }));
    expect(labels(elements)).not.toContain('More options');
    expect(labels(elements)).not.toContain('Search in chat');
    for (const element of elements) {
      expect(element.props.onPress).not.toBeUndefined();
    }
  });

  it('a topic title tap without an info handler is not a button', () => {
    const elements = buttonsFor(
      ChatHeader({ chat: topicChat(), onBack: () => {}, onSearchInChat: () => {} }),
    );
    expect(labels(elements)).not.toContain('Topic info for Checkout bug');
    for (const element of elements) {
      expect(element.props.onPress).not.toBeUndefined();
    }
  });

  it('a legacy group row title opens the group screen', () => {
    const elements = buttonsFor(
      ChatHeader({
        chat: chat({ id: 'team@rooms.galena.test', title: 'Team', kind: 'group', groupId: 'g1' }),
        onBack: () => {},
        onSearchInChat: () => {},
        onOpenGroup: () => {},
      }),
    );
    expect(labels(elements)).toContain('Open group Team');
    for (const element of elements) {
      expect(element.props.onPress).not.toBeUndefined();
    }
  });
});
