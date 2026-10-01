import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { UiMessage } from '@galena/chat-core';

import { MessageBubble } from './message-bubble';

// The mobile app has no React Native testing library, so the component is
// rendered with `react-dom/server` and the HTML is asserted on (the
// `topic-sheets-roles.test.tsx` pattern).
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

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CheckCheck: 'CheckCheck',
  Clock: 'Clock',
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

vi.mock('zustand', () => ({
  useStore: (_store: unknown, selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/components/chat/message-actions-sheet', () => ({
  MessageActionsSheet: ({
    canCopy,
    canEdit,
    canDelete,
    onReply,
    onEdit,
    onCopy,
    onDelete,
    onPin,
    onReact,
    onClose,
  }: {
    canCopy: boolean;
    canEdit: boolean;
    canDelete: boolean;
    onReply: () => void;
    onEdit: () => void;
    onCopy: () => void;
    onDelete: () => void;
    onPin?: () => void;
    onReact: (emoji: string) => void;
    onClose: () => void;
  }) => (
    <div
      data-can-copy={String(canCopy)}
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    >
      <button data-action="reply" onClick={onReply} />
      <button data-action="edit" onClick={onEdit} />
      <button data-action="copy" onClick={onCopy} />
      <button data-action="delete" onClick={onDelete} />
      <button data-action="pin" onClick={onPin} />
      <button data-action="react" onClick={() => onReact('👍')} />
      <button data-action="close" onClick={onClose} />
    </div>
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

const STICKER_CARD = {
  v: 0,
  type: 'sticker',
  data: {
    pack_id: '11111111-1111-4111-8111-111111111111',
    sticker_id: '223e4567-e89b-12d3-a456-426614174001',
    url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
    emoji: '🐱',
    width: 200,
    height: 200,
    mime: 'image/png',
  },
} as const;

function stickerMessage(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: 'm-sticker-1',
    chatId: 'ana',
    senderId: 'me',
    senderName: 'You',
    text: '🐱',
    createdAt: new Date(2026, 9, 1, 12, 0),
    status: 'sending',
    card: STICKER_CARD,
    ...overrides,
  };
}

const BASE = {
  isGroup: false,
  isFirstInGroup: true,
  isLastInGroup: true,
  currentUserId: 'me',
  onReply: () => {},
  message: stickerMessage(),
};

describe('MessageBubble sticker branch', () => {
  function bubbleHtml(props: { message: UiMessage }): string {
    return renderToStaticMarkup(createElement(MessageBubble, { ...BASE, ...props }));
  }

  it('renders the sticker without a bubble and without the menu Retry', () => {
    const html = bubbleHtml({ message: stickerMessage() });
    expect(html).toContain('StickerMessage');
    expect(html).not.toContain('Retry sending sticker');
  });

  it('shows Retry on a failed sticker', () => {
    const html = bubbleHtml({ message: stickerMessage({ failed: true }) });
    expect(html).toContain('Retry sending sticker');
    expect(html).toContain('StickerMessage');
  });

  it('offers no Edit and no Copy text for stickers in the menu', () => {
    // Incoming sticker: delete is not offered (not mine), edit and copy
    // are off because stickers carry no editable text.
    const html = bubbleHtml({ message: stickerMessage({ senderId: 'ana' }) });
    expect(html).toContain('data-can-edit="false"');
    expect(html).toContain('data-can-copy="false"');
    expect(html).toContain('data-can-delete="false"');
  });

  it('offers delete but still no Edit or Copy for my own sticker', () => {
    const html = bubbleHtml({ message: stickerMessage() });
    expect(html).toContain('data-can-edit="false"');
    expect(html).toContain('data-can-copy="false"');
    expect(html).toContain('data-can-delete="true"');
  });

  it('keeps Edit and Copy text for a plain text message', () => {
    const html = bubbleHtml({
      message: stickerMessage({ senderId: 'me', text: 'hello', card: undefined }),
    });
    expect(html).toContain('data-can-edit="true"');
    expect(html).toContain('data-can-copy="true"');
  });
});
