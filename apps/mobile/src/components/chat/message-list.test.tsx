import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';

import { filterBlockedMessages } from '@/lib/blocked-users';

import { MessageList } from './message-list';

// A Node render of the real list and bubbles (no React Native testing
// library): the `FlatList` stub renders every row, and the `Pressable` stub
// records its props on `globalThis` so a test can fire the "Select message"
// checkbox's `onPress` by hand.
type PressableProps = Record<string, unknown>;

function pressables(): PressableProps[] {
  return (
    (globalThis as { __messageListPressables?: PressableProps[] }).__messageListPressables ?? []
  );
}

function resetPressables(): void {
  (globalThis as { __messageListPressables?: PressableProps[] }).__messageListPressables = [];
}

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    Animated: {
      Value: class {
        setValue() {}
      },
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({}),
      timing: () => ({ start: () => {} }),
    },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    FlatList: (props: {
      data: Array<{ key: string }>;
      renderItem: (info: { item: unknown; index: number }) => ReactNode;
    }) =>
      h(
        'div',
        null,
        props.data.map((item, index) =>
          h('div', { key: item.key }, props.renderItem({ item, index })),
        ),
      ),
    Image: 'Image',
    Linking: { openURL: async () => {} },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    Pressable: (props: PressableProps) => {
      const scope = globalThis as { __messageListPressables?: PressableProps[] };
      (scope.__messageListPressables ??= []).push(props);
      return h('div', null, props['children'] as never);
    },
    ScrollView: 'ScrollView',
    StyleSheet: { absoluteFill: {} },
    Text: 'RNText',
    View: 'View',
  };
});

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: (initial: unknown) => ({ value: initial }),
}));

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Path: 'Path',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/store/chat-store-provider', () => {
  const first = new Date(Date.UTC(2026, 8, 28, 10, 0));
  const state = {
    currentUserId: 'you@zilar.test',
    chats: [
      {
        id: 'g1',
        title: 'Team',
        kind: 'group',
        isAI: false,
        space: 'personal',
        unread: 0,
        muted: false,
      },
    ],
    me: { jid: 'you@zilar.test' },
    messages: () => [
      {
        id: 'm1',
        chatId: 'g1',
        senderId: 'bea@zilar.test',
        senderName: 'Bea',
        text: 'message m1',
        createdAt: first,
        status: 'read',
      },
      {
        id: 'm2',
        chatId: 'g1',
        senderId: 'you@zilar.test',
        senderName: 'You',
        text: 'message m2',
        createdAt: new Date(first.getTime() + 60_000),
        status: 'read',
      },
    ],
    jumpTarget: undefined,
    clearJumpTarget: () => {},
    historyLoad: { g1: 'ready' },
    retryHistory: () => {},
    drafts: {},
    finishedDraftMessages: {},
    loadOlder: () => {},
    hasMore: () => false,
    canPin: () => true,
  };
  return {
    useChatStore: (selector: (state: unknown) => unknown) => selector(state),
    useChatStoreApi: () => ({ getState: () => state }),
  };
});

vi.mock('zustand', () => ({
  useStore: (_store: unknown, selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/components/contacts/use-contacts-api', () => ({
  useContactsApi: () => ({ api: {} }),
}));

vi.mock('@/lib/blocked-users', async () => {
  const actual = (await vi.importActual('@/lib/blocked-users')) as Record<string, unknown>;
  return { ...actual, useBlockedJids: () => new Set<string>() };
});

vi.mock('@/components/chat/date-separator', () => ({ DateSeparator: 'DateSeparator' }));
vi.mock('@/components/chat/unread-divider', () => ({ UnreadDivider: 'UnreadDivider' }));
vi.mock('@/components/chat/skeleton', () => ({ MessageListSkeleton: 'MessageListSkeleton' }));
vi.mock('@/components/chat/load-error', () => ({ LoadError: 'LoadError' }));
vi.mock('@/components/chat/jump-scroll', () => ({ startJumpScroll: () => () => {} }));
vi.mock('@/components/ui/state-message', () => ({ StateMessage: 'StateMessage' }));
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'Checkbox' }));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));

vi.mock('@/components/chat/message-actions-sheet', () => ({
  MessageActionsSheet: 'MessageActionsSheet',
}));
vi.mock('@/components/chat/avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/chat/attachment-body', () => ({ AttachmentBody: 'AttachmentBody' }));
vi.mock('@/components/chat/forwarded-header', () => ({ ForwardedHeader: 'ForwardedHeader' }));
vi.mock('@/components/chat/image-message', () => ({ ImageMessage: 'ImageMessage' }));
vi.mock('@/components/chat/link-text', () => ({ LinkText: 'LinkText' }));
vi.mock('@/components/chat/markdown-text', () => ({ MarkdownText: 'MarkdownText' }));
vi.mock('@/components/chat/payload-card', () => ({
  PayloadCard: 'PayloadCard',
  stickerOf: () => undefined,
}));
vi.mock('@/components/chat/progress-card', () => ({ ProgressCard: 'ProgressCard' }));
vi.mock('@/components/chat/approval-card', () => ({ ApprovalCard: 'ApprovalCard' }));
vi.mock('@/components/chat/reaction-chips', () => ({ ReactionChips: 'ReactionChips' }));
vi.mock('@/components/chat/reply-quote', () => ({ ReplyQuote: 'ReplyQuote' }));
vi.mock('@/components/chat/sticker-message', () => ({ StickerMessage: 'StickerMessage' }));
vi.mock('@/components/chat/swipe-to-reply', () => ({
  SwipeToReply: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/chat/ticks', () => ({ Ticks: 'Ticks' }));
vi.mock('@/components/chat/typing-dots', () => ({ PulseDot: 'PulseDot' }));
vi.mock('@/components/chat/voice-message', () => ({ VoiceMessage: 'VoiceMessage' }));

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CheckCheck: 'CheckCheck',
  Clock: 'Clock',
  Forward: 'Forward',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  Smile: 'Smile',
  Sticker: 'StickerIcon',
  X: 'X',
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: async () => {},
}));

vi.mock('expo-haptics', () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('@/lib/color-scheme', () => ({ asColorScheme: () => 'dark' }));
vi.mock('@/lib/colors', () => ({
  BUBBLE_COLORS: { dark: { outgoingMeta: '#555', incomingMeta: '#555' } },
  ICON: { dark: '#d4d4d4' },
  ACCENT_FOREGROUND: { dark: '#0a0a0a' },
}));
vi.mock('@/lib/depth', () => ({
  WELL_BACKGROUND: '#0c0c0c',
  bubbleStyle: () => ({}),
  raisedPill: {},
  senderColor: () => '#fff',
  well: {},
  iconKey: {},
  primaryKey: {},
  pressStyle: () => ({}),
  ACCENT_FOREGROUND: '#0a0a0a',
  KEY_PRIMARY_PRESSED_SHADOW: '',
}));
vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));
vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));
vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

function message(id: string, senderId: string): UiMessage {
  return {
    id,
    chatId: 'g1',
    senderId,
    senderName: senderId,
    text: `message ${id}`,
    createdAt: new Date(2026, 8, 28, 10, 0),
    status: 'read',
  };
}

const group: ChatSummary = {
  id: 'g1',
  title: 'Team',
  kind: 'group',
  isAI: false,
  space: 'personal',
  unread: 0,
  muted: false,
};

describe('filterBlockedMessages', () => {
  it('drops a blocked sender in a group and keeps the rest', () => {
    const messages = [
      message('m1', 'carlos@zilar.test'),
      message('m2', 'bea@zilar.test'),
      message('m3', 'u-you'),
    ];
    expect(
      filterBlockedMessages(group, messages, new Set(['bea']), 'u-you').map((item) => item.id),
    ).toEqual(['m1', 'm3']);
  });

  it('keeps my own messages even when my localpart is blocked', () => {
    const mine = message('m1', 'bea@zilar.test');
    expect(filterBlockedMessages(group, [mine], new Set(['bea']), 'bea@zilar.test')).toEqual([
      mine,
    ]);
  });

  it('leaves a DM untouched', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    const chat: ChatSummary = { ...group, kind: 'dm' };
    expect(filterBlockedMessages(chat, messages, new Set(['bea']), 'u-you')).toBe(messages);
  });

  it('leaves an AI group untouched', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    const chat: ChatSummary = { ...group, isAI: true, kind: 'ai' };
    expect(filterBlockedMessages(chat, messages, new Set(['bea']), 'u-you')).toBe(messages);
  });

  it('does not copy the list when nobody is blocked', () => {
    const messages = [message('m1', 'bea@zilar.test')];
    expect(filterBlockedMessages(group, messages, new Set(), 'u-you')).toBe(messages);
  });
});

describe('MessageList selection (T-0445)', () => {
  it('shows a checkbox on every bubble and toggles the pressed one', () => {
    resetPressables();
    const onToggle = vi.fn();
    const onStart = vi.fn();
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        chat: group,
        onReply: () => {},
        pinnedIds: [],
        selection: { ids: ['m1'], onToggle, onStart },
      }),
    );

    expect(html).toContain('message m1');
    expect(html).toContain('message m2');

    const selects = pressables().filter(
      (props) =>
        props['accessibilityRole'] === 'checkbox' &&
        props['accessibilityLabel'] === 'Select message',
    );
    expect(selects).toHaveLength(2);

    const state = (props: PressableProps): { checked: boolean } =>
      props['accessibilityState'] as { checked: boolean };
    expect(selects.filter((props) => state(props).checked)).toHaveLength(1);

    const selected = selects.find((props) => state(props).checked);
    (selected?.['onPress'] as (() => void) | undefined)?.();
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('renders no checkboxes without a selection', () => {
    resetPressables();
    renderToStaticMarkup(
      createElement(MessageList, { chat: group, onReply: () => {}, pinnedIds: [] }),
    );
    expect(
      pressables().filter((props) => props['accessibilityLabel'] === 'Select message'),
    ).toHaveLength(0);
  });
});
