import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { UiMessage } from '@zilar/chat-core';

import { MessageBubble } from './message-bubble';

// Same stubs as `message-bubble-ticks.test.tsx`, except the host primitives
// serialize their `style` into a `data-style` attribute so a Node test can read
// the numeric layout the component applies (React Native has no testing library
// here).
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  const styled =
    (tag: string) =>
    (props: Record<string, unknown>): unknown => {
      const { children, style, ...rest } = props;
      return h(
        tag,
        {
          ...rest,
          ...(style === undefined ? {} : { 'data-style': JSON.stringify(style) }),
        },
        children as never,
      );
    };
  return {
    Animated: {
      View: styled('AnimatedView'),
      Value: class {
        setValue() {}
      },
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({}),
      timing: () => ({ start: () => {} }),
    },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    Image: styled('Image'),
    Linking: { openURL: async () => {} },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
    Pressable: styled('Pressable'),
    ScrollView: styled('ScrollView'),
    StyleSheet: { absoluteFill: {} },
    Text: styled('RNText'),
    View: styled('View'),
  };
});

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

vi.mock('@/components/chat/message-actions-sheet', () => ({
  MessageActionsSheet: () => createElement('MessageActionsSheet'),
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
vi.mock('@/lib/color-scheme', () => ({ asColorScheme: () => 'dark' }));
vi.mock('@/lib/colors', () => ({
  BUBBLE_COLORS: { dark: { outgoingMeta: '#555', incomingMeta: '#555' } },
  ICON: { dark: '#d4d4d4' },
  MUTED_FOREGROUND: { dark: '#888888' },
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

describe('MessageBubble layout', () => {
  it('nudges the inline ticks down onto the time baseline', () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, BASE));
    // The 14x11 inline tick slot carries `transform: [{ translateY: 2 }]`; the
    // `data-style` attribute exposes it to this Node-only render.
    const nudged = html.match(/&quot;translateY&quot;:2/g) ?? [];
    expect(nudged).toHaveLength(1);
  });

  it('keeps the inline ticks inside the time text behind a no-break space', () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, BASE));
    const ticks = html.indexOf('<Ticks');
    expect(ticks).toBeGreaterThan(-1);
    const beforeTicks = html.slice(0, ticks);
    const viewOpen = beforeTicks.lastIndexOf('<View');
    expect(viewOpen).toBeGreaterThan(-1);
    // The no-break space and word joiner sit directly before the inline view...
    expect(beforeTicks.slice(viewOpen - 2, viewOpen)).toBe('\u00a0\u2060');
    // ...inside the meta `Text`: it has not closed before the tick.
    expect(beforeTicks.slice(0, viewOpen)).not.toContain('</Text>');
  });

  it('shows the forwarded header for a message with a forward origin', () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        ...BASE,
        message: textMessage({
          forward: {
            sender_id: 'luis@zilar.test',
            sender_name: 'Luis',
            chat_id: 'viernes@conference.zilar.test',
            chat_name: 'Friday plans',
            original_at: '2026-08-30T18:00:00.000Z',
          },
        }),
      }),
    );
    expect(html).toContain('Forwarded from Luis in Friday plans');
  });

  it('shows the forwarded header on a single-emoji message', () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        ...BASE,
        message: textMessage({
          text: '🎉',
          forward: {
            sender_id: 'luis@zilar.test',
            sender_name: 'Luis',
            original_at: '2026-08-30T18:00:00.000Z',
          },
        }),
      }),
    );
    expect(html).toContain('Forwarded from');
  });
});
