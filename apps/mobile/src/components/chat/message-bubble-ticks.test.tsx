import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { UiMessage } from '@zilar/chat-core';

import { MessageBubble } from './message-bubble';

// Same mocks as `message-bubble-stickers.test.tsx`: the mobile app has no
// React Native testing library, so the component is rendered with
// `react-dom/server` and the HTML is asserted on.
vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue() {}
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    sequence: () => ({}),
    timing: () => ({ start: () => {} }),
  },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Image: 'Image',
  Linking: { openURL: async () => {} },
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { absoluteFill: {} },
  Text: 'RNText',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  useSharedValue: (initial: unknown) => ({ value: initial }),
}));

vi.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  default: ({ children }: { children: unknown }) => children,
  SwipeDirection: { LEFT: 'left', RIGHT: 'right' },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Path: 'Path',
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: async () => {},
}));

vi.mock('expo-haptics', () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light' },
}));

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

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => false,
  useChatStoreApi: () => ({ getState: () => ({}) }),
}));

vi.mock('@/components/chat/message-actions-sheet', () => ({
  MessageActionsSheet: ({
    canCopy,
    canEdit,
    canDelete,
  }: {
    canCopy: boolean;
    canEdit: boolean;
    canDelete: boolean;
  }) => (
    <div
      data-can-copy={String(canCopy)}
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    />
  ),
}));
vi.mock('@/components/chat/avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/chat/attachment-body', () => ({ AttachmentBody: 'AttachmentBody' }));
vi.mock('@/components/chat/image-message', () => ({ ImageMessage: 'ImageMessage' }));
vi.mock('@/components/chat/link-text', () => ({ LinkText: 'LinkText' }));
vi.mock('@/components/chat/markdown-text', () => ({ MarkdownText: 'MarkdownText' }));
vi.mock('@/components/chat/payload-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./payload-card')>();
  return { ...actual, PayloadCard: 'PayloadCard' };
});
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
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/lib/colors', () => ({
  BUBBLE_COLORS: { outgoingMeta: '#555', incomingMeta: '#555' },
  ICON: '#d4d4d4',
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

function textMessage(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: 'm-text-1',
    chatId: 'ana',
    senderId: 'me',
    senderName: 'You',
    text: 'hello there',
    createdAt: new Date(),
    status: 'read',
    ...overrides,
  };
}

const BASE = {
  isGroup: false,
  isFirstInGroup: true,
  isLastInGroup: true,
  currentUserId: 'me',
  onReply: () => {},
  message: textMessage(),
};

describe('MessageBubble inline ticks', () => {
  function bubbleHtml(props: { message: UiMessage }): string {
    return renderToStaticMarkup(createElement(MessageBubble, { ...BASE, ...props }));
  }

  it('renders the Ticks icon after the time on an outgoing read text message', () => {
    const html = bubbleHtml({ message: textMessage({ status: 'read' }) });
    expect(html).toContain('Ticks');
  });

  it('uses no tick glyphs in the bubble text', () => {
    for (const status of ['sending', 'sent', 'read', 'failed'] as const) {
      const html = bubbleHtml({ message: textMessage({ status }) });
      expect(html).not.toContain('✓');
      expect(html).not.toContain('○');
    }
  });

  it('renders no Ticks icon on an incoming text message', () => {
    const html = bubbleHtml({
      message: textMessage({ senderId: 'ana', senderName: 'Ana', status: 'read' }),
    });
    expect(html).not.toContain('Ticks');
    expect(html).not.toContain('✓');
    expect(html).not.toContain('○');
  });
});
