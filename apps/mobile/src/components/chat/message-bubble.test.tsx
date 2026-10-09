import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiMessage } from '@zilar/chat-core';

import { MessageBubble } from './message-bubble';

// The mobile app has no React Native testing library, so the bubble is
// rendered with `react-dom/server`. The render records the props of the
// action sheet and of the bubble's long-press `Pressable`, so a test can run
// the menu's Copy and the long-press by hand and check the native calls.
const seen = vi.hoisted(() => ({
  sheet: undefined as { onCopy: () => void } | undefined,
  longPresses: [] as Array<() => void>,
  setStringAsync: vi.fn(async (_text: string) => {}),
  impactAsync: vi.fn(async (_style: string) => {}),
}));

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
    Image: 'Image',
    Linking: { openURL: async () => {} },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    Pressable: (props: { onLongPress?: () => void; children?: ReactNode }) => {
      if (props.onLongPress !== undefined) {
        seen.longPresses.push(props.onLongPress);
      }
      return h('div', null, props.children);
    },
    ScrollView: 'ScrollView',
    StyleSheet: { absoluteFill: {} },
    Text: 'RNText',
    View: 'View',
  };
});

vi.mock('expo-clipboard', () => ({
  setStringAsync: seen.setStringAsync,
}));

vi.mock('expo-haptics', () => ({
  impactAsync: seen.impactAsync,
  ImpactFeedbackStyle: { Light: 'light' },
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

vi.mock('@/components/chat/swipe-to-reply', () => ({
  SwipeToReply: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/components/chat/message-actions-sheet', () => ({
  MessageActionsSheet: (props: { onCopy: () => void }) => {
    seen.sheet = props;
    return null;
  },
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
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

vi.mock('@/components/chat/avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/chat/attachment-body', () => ({ AttachmentBody: 'AttachmentBody' }));
vi.mock('@/components/chat/image-message', () => ({ ImageMessage: 'ImageMessage' }));
vi.mock('@/components/chat/link-text', () => ({ LinkText: 'LinkText' }));
vi.mock('@/components/chat/markdown-text', () => ({ MarkdownText: 'MarkdownText' }));
vi.mock('@/components/chat/progress-card', () => ({ ProgressCard: 'ProgressCard' }));
vi.mock('@/components/chat/approval-card', () => ({ ApprovalCard: 'ApprovalCard' }));
vi.mock('@/components/chat/reaction-chips', () => ({ ReactionChips: 'ReactionChips' }));
vi.mock('@/components/chat/reply-quote', () => ({ ReplyQuote: 'ReplyQuote' }));
vi.mock('@/components/chat/sticker-message', () => ({ StickerMessage: 'StickerMessage' }));
vi.mock('@/components/chat/ticks', () => ({ Ticks: 'Ticks' }));
vi.mock('@/components/chat/typing-dots', () => ({ PulseDot: 'PulseDot' }));
vi.mock('@/components/chat/voice-message', () => ({ VoiceMessage: 'VoiceMessage' }));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/lib/color-scheme', () => ({ asColorScheme: () => 'dark' }));
vi.mock('@/lib/colors', () => ({
  BUBBLE_COLORS: { dark: { outgoingMeta: '#555', incomingMeta: '#555' } },
  ICON: { dark: '#d4d4d4' },
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

const TEXT_MESSAGE: UiMessage = {
  id: 'm-text-1',
  chatId: 'ana',
  senderId: 'ana',
  senderName: 'Ana',
  text: 'Hello there',
  createdAt: new Date('2026-09-28T12:00:00Z'),
  status: 'read',
};

function render(props: { message: UiMessage; currentUserId?: string }): string {
  return renderToStaticMarkup(
    createElement(MessageBubble, {
      isGroup: false,
      isFirstInGroup: true,
      isLastInGroup: true,
      currentUserId: props.currentUserId ?? 'me',
      onReply: () => {},
      message: props.message,
    }),
  );
}

describe('MessageBubble', () => {
  beforeEach(() => {
    seen.sheet = undefined;
    seen.longPresses = [];
    seen.setStringAsync.mockClear();
    seen.impactAsync.mockClear();
  });

  it('shows the text of an incoming message', () => {
    const html = render({ message: TEXT_MESSAGE });
    expect(html).toContain('Hello there');
  });

  it('shows the tombstone text for a deleted message, from the other side too', () => {
    const deleted = { ...TEXT_MESSAGE, deleted: true };
    expect(render({ message: deleted })).toContain('This message was deleted');
    const mine = { ...deleted, senderId: 'me' };
    expect(render({ message: mine })).toContain('You deleted this message');
  });

  it('copies the message text from the menu through the clipboard', () => {
    render({ message: TEXT_MESSAGE });
    expect(seen.sheet).toBeDefined();
    seen.sheet?.onCopy();
    expect(seen.setStringAsync).toHaveBeenCalledWith('Hello there');
  });

  it('gives a light haptic on long press and opens the menu', () => {
    render({ message: TEXT_MESSAGE });
    expect(seen.longPresses).toHaveLength(1);
    seen.longPresses[0]?.();
    expect(seen.impactAsync).toHaveBeenCalledWith('light');
  });

  it('still handles the long press when the haptic fails', async () => {
    seen.impactAsync.mockRejectedValueOnce(new Error('no haptics'));
    render({ message: TEXT_MESSAGE });
    expect(() => seen.longPresses[0]?.()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.impactAsync).toHaveBeenCalledWith('light');
  });
});
