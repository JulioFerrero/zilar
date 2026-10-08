import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { UiMessage } from '@zilar/chat-core';

import { AttachmentBody } from './attachment-body';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

vi.mock('react-native-gesture-handler', () => ({
  PinchGestureHandler: 'PinchGestureHandler',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-video', () => ({
  useVideoPlayer: () => ({ loop: false, muted: false }),
  VideoView: 'VideoView',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/depth', () => ({
  raisedPill: { borderWidth: 1 },
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/components/chat/ticks', () => ({
  Ticks: 'Ticks',
}));

vi.mock('lucide-react-native', () => ({
  ArrowUpRight: 'ArrowUpRight',
  FileText: 'FileText',
  Play: 'Play',
  RotateCcw: 'RotateCcw',
  Video: 'Video',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

vi.mock('@/lib/colors', () => ({
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => new Set(['upload.zilar.test', 'zilar.test']),
  useChatStoreApi: () => ({ getState: () => ({}) }),
}));

function bodyMessage(overrides: Partial<UiMessage> = {}): UiMessage {
  return {
    id: 'm-attachment-1',
    chatId: 'ana',
    senderId: 'ana',
    senderName: 'Ana',
    text: 'Stage!',
    createdAt: new Date(2026, 9, 1, 12, 0),
    status: 'read',
    attachment: {
      kind: 'image',
      url: 'https://upload.zilar.test/get/stage.png',
      name: 'stage.png',
      size: 245_760,
      mime: 'image/png',
      width: 640,
      height: 420,
    },
    ...overrides,
  };
}

describe('attachment bubble body (T-0150)', () => {
  it('renders the image with the caption', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentBody, { message: bodyMessage(), outgoing: false }),
    );
    expect(html).toContain('stage.png');
    expect(html).toContain('Stage!');
  });

  it('renders a file row for a non-image attachment', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentBody, {
        message: bodyMessage({
          text: undefined,
          attachment: {
            kind: 'file',
            url: 'https://upload.zilar.test/get/tickets.pdf',
            name: 'tickets.pdf',
            size: 2_411_724,
            mime: 'application/pdf',
          },
        }),
        outgoing: false,
      }),
    );
    expect(html).toContain('tickets.pdf');
    expect(html).toContain('2.3 MB');
  });

  it('renders the video player for a gif- video attachment', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentBody, {
        message: bodyMessage({
          text: undefined,
          attachment: {
            kind: 'file',
            url: 'https://upload.zilar.test/get/abc',
            name: 'gif-abc123.mp4',
            size: 1_000_000,
            mime: 'video/mp4',
          },
        }),
        outgoing: false,
      }),
    );
    expect(html).toContain('VideoView');
  });

  it('shows Retry with no caption edit on a failed upload', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentBody, {
        message: bodyMessage({ failed: true, status: 'sending' }),
        outgoing: true,
      }),
    );
    expect(html).toContain('Retry sending attachment');
  });

  it('shows Cancel while the upload runs', () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentBody, {
        message: bodyMessage({ status: 'sending' }),
        outgoing: true,
      }),
    );
    expect(html).toContain('Cancel upload');
  });
});
