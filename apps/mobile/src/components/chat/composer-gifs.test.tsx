import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { Composer } from './composer';
import { resetGifsAvailability, setGifsAvailability } from '@/lib/gifs';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  Smile: 'Smile',
  Sticker: 'StickerIcon',
  X: 'X',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => undefined,
  useChatStoreApi: () => ({ getState: () => ({}) }),
}));

vi.mock('zustand', () => ({
  useStore: (_store: unknown, selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/stickers-api', () => ({
  createStickersApi: () => ({ listStickerPacks: async () => [] }),
}));

vi.mock('@/lib/attachment-native', () => ({
  createAttachmentPicker: () => ({
    pickImageOrVideo: async () => ({ status: 'cancelled' }),
    takePhoto: async () => ({ status: 'cancelled' }),
    pickFile: async () => ({ status: 'cancelled' }),
  }),
  createGifDownloader: () => ({
    download: async () => ({ status: 'error', message: 'Could not load that GIF. Try another.' }),
  }),
}));

vi.mock('@/lib/gifs-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gifs-api')>();
  return {
    ...actual,
    createGifsApi: () => ({
      searchGifs: async () => ({ items: [] }),
      trendingGifs: async () => ({ items: [] }),
    }),
  };
});

function composer(): string {
  return renderToStaticMarkup(
    createElement(Composer, {
      onSend: () => {},
      onSendSticker: () => {},
      onSendAttachment: () => {},
      onCancelReply: () => {},
    }),
  );
}

describe('composer GIF tab (T-0148)', () => {
  it('shows the GIFs button while availability is unknown', () => {
    resetGifsAvailability();
    expect(composer()).toContain('GIFs');
    resetGifsAvailability();
  });

  it('hides the GIFs button once the server answers 501 (provider off)', () => {
    setGifsAvailability(false);
    expect(composer()).not.toContain('GIFs');
    resetGifsAvailability();
  });

  it('shows the GIFs button once the provider answers', () => {
    setGifsAvailability(true);
    expect(composer()).toContain('GIFs');
    resetGifsAvailability();
  });
});
