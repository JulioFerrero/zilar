import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { Composer, fieldHeightFor } from './composer';
import { EmojiSheet } from './emoji-sheet';
import { gifsAvailability, resetGifsAvailability, setGifsAvailability } from '@/lib/gifs';

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Image: 'Image',
  Keyboard: { dismiss: () => {} },
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
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
  CircleAlert: 'CircleAlert',
  Clock: 'Clock',
  Film: 'Film',
  Hand: 'Hand',
  Hash: 'Hash',
  Heart: 'Heart',
  Inbox: 'Inbox',
  Lightbulb: 'Lightbulb',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  PawPrint: 'PawPrint',
  Pizza: 'Pizza',
  Plane: 'Plane',
  Smile: 'Smile',
  Sticker: 'StickerIcon',
  Trophy: 'Trophy',
  X: 'X',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/lib/depth', () => ({
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
  well: {},
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

function readComposerSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'composer.tsx'), 'utf8');
}

/**
 * The sheet as the composer wires it: the GIFs tab is visible unless the
 * probe said off (`gifsVisible={gifAvailable !== false}`, seeded from the
 * availability cache). The sheet starts closed, so the row markup never
 * shows the tabs — this renders it open with the composer's expression.
 */
function sheetForAvailability(): string {
  return renderToStaticMarkup(
    createElement(EmojiSheet, {
      open: true,
      tab: undefined,
      onSelectTab: () => {},
      gifsVisible: gifsAvailability() !== false,
      emojiRecents: [],
      emojiCategory: undefined,
      onSelectEmojiCategory: () => {},
      onPickEmoji: () => {},
      packs: [],
      panelState: 'empty',
      stickerRecents: [],
      activePackId: undefined,
      onSelectPack: () => {},
      onPickSticker: () => {},
      onRetryStickers: () => {},
      mockGifItems: [],
      onPickGif: () => {},
      onClose: () => {},
    }),
  );
}

describe('composer GIF tab (T-0148, sheet tabs in T-0175)', () => {
  it('offers the GIFs sheet tab while availability is unknown', () => {
    resetGifsAvailability();
    expect(composer()).toContain('Emoji');
    expect(sheetForAvailability()).toContain('>GIFs<');
    resetGifsAvailability();
  });

  it('hides the GIFs sheet tab once the server answers 501 (provider off)', () => {
    setGifsAvailability(false);
    expect(sheetForAvailability()).not.toContain('>GIFs<');
    expect(sheetForAvailability()).toContain('>Emoji<');
    resetGifsAvailability();
  });

  it('offers the GIFs sheet tab once the provider answers', () => {
    setGifsAvailability(true);
    expect(sheetForAvailability()).toContain('>GIFs<');
    resetGifsAvailability();
  });

  it('wires the composer to the availability cache', () => {
    expect(readComposerSource()).toContain('gifsVisible={gifAvailable !== false}');
  });
});

describe('composer emoji row (T-0175)', () => {
  it('has exactly one emoji-related button: no Sticker or GIF buttons', () => {
    const html = composer();
    expect(html).toContain('Emoji');
    expect(html).not.toContain('Stickers');
    expect(html).not.toContain('>GIF<');
    expect(html.match(/<IconButton/g)?.length ?? 0).toBe(2);
  });

  it('tracks the caret so emoji insert at the selection', () => {
    const source = readComposerSource();
    expect(source).toContain('onSelectionChange');
    expect(source).toContain('insertEmojiAtCaret');
  });
});

describe('fieldHeightFor (T-0175)', () => {
  it('keeps an empty one-line field at MIN_INPUT_HEIGHT (36)', () => {
    expect(fieldHeightFor(20)).toBe(36);
    expect(fieldHeightFor(36)).toBe(36);
    expect(fieldHeightFor(0)).toBe(36);
  });

  it('grows with two lines and caps at eight', () => {
    expect(fieldHeightFor(40)).toBe(40);
    expect(fieldHeightFor(132)).toBe(132);
    expect(fieldHeightFor(200)).toBe(132);
  });

  it('never returns NaN for a hostile content height', () => {
    expect(fieldHeightFor(Number.NaN)).toBe(36);
  });
});
