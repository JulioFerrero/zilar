import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ChatSummary, UiMessage } from '@zilar/chat-core';

import { ForwardSheet, forwardSendLabel, forwardTargets } from './forward-sheet';

vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: true, setPressed: () => {} }),
}));

vi.mock('@/components/chat/avatar', () => ({
  Avatar: 'Avatar',
}));

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Search: 'Search',
  X: 'X',
}));

vi.mock('@/lib/colors', () => ({
  MUTED_FOREGROUND: '#888888',
  ACCENT_FOREGROUND: '#0a0a0a',
}));

vi.mock('@/lib/depth', () => ({
  well: {},
  primaryKey: {},
  pressStyle: () => ({}),
  KEY_PRIMARY_PRESSED_SHADOW: {},
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

vi.mock('@/lib/use-keyboard-height', () => ({
  sheetBottomPadding: () => 0,
  useKeyboardHeight: () => 0,
}));

// The sheet reads the chat list and the forward action from the store; this
// Node render only needs the rows to show.
vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      chats: [
        {
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
        },
        {
          id: 'd-ana',
          title: 'Ana',
          kind: 'dm',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
        },
        {
          id: 'archived',
          title: 'Old room',
          kind: 'group',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
          archived: true,
        },
      ],
      forwardMessages: () => {},
    }),
}));

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'c1',
    title: 'Team',
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    ...overrides,
  };
}

function message(): UiMessage {
  return {
    id: 'm1',
    chatId: 'ana',
    senderId: 'me',
    senderName: 'You',
    text: 'hello there',
    createdAt: new Date(),
    status: 'read',
  };
}

describe('forwardTargets', () => {
  it('hides archived chats and non-postable channels, keeps owner and admin channels', () => {
    const chats = [
      chat({ id: 'group', title: 'Team' }),
      chat({ id: 'archived', title: 'Old room', archived: true }),
      chat({ id: 'member', title: 'Feed', chatKind: 'channel', myRole: 'member' }),
      chat({ id: 'owner', title: 'News', chatKind: 'channel', myRole: 'owner' }),
      chat({ id: 'admin', title: 'Announce', chatKind: 'channel', myRole: 'admin' }),
    ];
    expect(forwardTargets(chats, '').map((entry) => entry.id)).toEqual(['group', 'owner', 'admin']);
  });

  it('matches by title and by group title', () => {
    const chats = [
      chat({ id: 'topic', title: 'Checkout bug', groupTitle: 'Dev team' }),
      chat({ id: 'group', title: 'Weekend plans', groupTitle: 'Friends' }),
      chat({ id: 'other', title: 'Groceries' }),
    ];
    expect(forwardTargets(chats, 'checkout').map((entry) => entry.id)).toEqual(['topic']);
    expect(forwardTargets(chats, 'dev').map((entry) => entry.id)).toEqual(['topic']);
    expect(forwardTargets(chats, '  FRIENDS ').map((entry) => entry.id)).toEqual(['group']);
    expect(forwardTargets(chats, 'nothing')).toEqual([]);
  });
});

describe('forwardSendLabel', () => {
  it('reads Send for one target and the count beyond that', () => {
    expect(forwardSendLabel(1)).toBe('Send');
    expect(forwardSendLabel(3)).toBe('Send to 3 chats');
  });
});

describe('ForwardSheet', () => {
  it('shows the target rows with the topic breadcrumb and a disabled Send', () => {
    const html = renderToStaticMarkup(
      createElement(ForwardSheet, { messages: [message()], onClose: () => {} }),
    );
    expect(html).toContain('Forward');
    expect(html).toContain('Dev team › Checkout bug');
    expect(html).toContain('Ana');
    expect(html).not.toContain('Old room');
    expect(html).toContain('Add a comment (optional)');
    expect(html).toContain('>Send<');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
});
