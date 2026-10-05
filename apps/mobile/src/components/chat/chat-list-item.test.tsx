import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSummary, UiMessage } from '@zilar/chat-core';

import { ChatListItem } from './chat-list-item';

const state = vi.hoisted(() => ({
  messages: [] as UiMessage[],
  blocked: new Set<string>(),
  currentUserId: 'me',
}));

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
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

vi.mock('@/components/chat/ticks', () => ({
  Ticks: 'Ticks',
}));

vi.mock('@/components/chat/typing-dots', () => ({
  PulseDot: 'PulseDot',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/lib/blocked-users', () => ({
  useBlockedJids: () => state.blocked,
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
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      typing: {},
      drafts: {},
      currentUserId: state.currentUserId,
      messages: () => state.messages,
    }),
}));

vi.mock('lucide-react-native', () => ({
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

function hasTicks(elements: TestElement[]): boolean {
  return elements.some((element) => element.type === 'Ticks');
}

function message(id: string, senderId: string, text: string): UiMessage {
  return {
    id,
    chatId: 'dm-1',
    senderId,
    senderName: senderId,
    text,
    createdAt: new Date(2026, 8, 28, 10, 0),
    status: 'read',
  };
}

function dmChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'dm-1',
    title: 'Ana',
    kind: 'dm',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

describe('ChatListItem', () => {
  beforeEach(() => {
    state.messages = [];
    state.blocked = new Set();
    state.currentUserId = 'me';
  });

  it('shows ticks when the last message is mine under the store user id', () => {
    state.currentUserId = 'u-42';
    const last = message('m1', 'u-42', 'mine');
    state.messages = [last];
    const elements = collect(
      ChatListItem({ chat: dmChat({ lastMessage: last }), onPress: () => {} }),
    );
    expect(hasTicks(elements)).toBe(true);
  });

  it('shows no ticks when the last message is someone else under the store user id', () => {
    state.currentUserId = 'u-42';
    const last = message('m1', 'u-7', 'theirs');
    state.messages = [last];
    const elements = collect(
      ChatListItem({ chat: dmChat({ lastMessage: last }), onPress: () => {} }),
    );
    expect(hasTicks(elements)).toBe(false);
  });
});
