import { describe, expect, it, vi } from 'vitest';

import type { ChatSummary } from '@galena/chat-core';

import { TopicRow } from './topic-row';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
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

vi.mock('./ai-badge', () => ({
  AiBadge: 'AiBadge',
}));

vi.mock('./ticks', () => ({
  Ticks: 'Ticks',
}));

vi.mock('./typing-dots', () => ({
  PulseDot: 'PulseDot',
}));

vi.mock('@/components/chat/ai-badge', () => ({
  AiBadge: 'AiBadge',
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('@/components/chat/markdown-decision', () => ({
  plainPreviewBody: () => '',
}));

vi.mock('@/components/chat/ticks', () => ({
  Ticks: 'Ticks',
}));

vi.mock('@/components/chat/typing-dots', () => ({
  PulseDot: 'PulseDot',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/format', () => ({
  previewParts: () => ({}),
  typingLabel: () => undefined,
}));

vi.mock('@/lib/topics', () => ({
  topicStatusLabel: (status: string) => status,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

vi.mock('@/lib/colors', () => ({
  MUTED_FOREGROUND: { dark: '#8a8a8a', light: '#8a8a8a' },
}));

vi.mock('@/lib/depth', () => ({
  primaryKey: {},
  raisedPill: {},
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

vi.mock('@/lib/types', () => ({
  CURRENT_USER_ID: 'me',
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => undefined,
}));

vi.mock('lucide-react-native', () => ({
  Lock: 'Lock',
  Pin: 'Pin',
  VolumeX: 'VolumeX',
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
    .filter((element) => element.type === 'View')
    .map((element) => element.props.accessibilityLabel)
    .filter((label) => label !== undefined);
}

const BASE = {
  onPress: () => {},
  onLongPress: () => {},
};

describe('TopicRow', () => {
  it('renders the title with no pin or muted icon by default', () => {
    const elements = collect(TopicRow({ ...BASE, chat: topicChat() }));
    expect(textOf(elements)).toContain('Checkout bug');
    expect(labels(elements)).not.toContain('Pinned chat');
    expect(labels(elements)).not.toContain('Muted chat');
  });

  it('shows pin and muted icons when the topic is pinned and muted', () => {
    const elements = collect(
      TopicRow({ ...BASE, chat: topicChat({ muted: true, pinnedAt: new Date() }) }),
    );
    expect(labels(elements)).toContain('Pinned chat');
    expect(labels(elements)).toContain('Muted chat');
  });

  it('renders the muted unread badge in the grey style', () => {
    const elements = collect(TopicRow({ ...BASE, chat: topicChat({ unread: 3, muted: true }) }));
    expect(textOf(elements)).toContain('3');
  });
});
