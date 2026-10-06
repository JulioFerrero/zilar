import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { EmojiSheet, resolveSheetTab } from './emoji-sheet';
import { stickerCellSize, stickerThumbSize } from './sticker-panel';
import type { RecentStickerEntry, StickerPack } from '@/lib/stickers';

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Keyboard: { dismiss: () => {} },
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  Clock: 'Clock',
  Film: 'Film',
  Hand: 'Hand',
  Hash: 'Hash',
  Heart: 'Heart',
  Lightbulb: 'Lightbulb',
  PawPrint: 'PawPrint',
  Pizza: 'Pizza',
  Plane: 'Plane',
  Search: 'Search',
  Smile: 'Smile',
  Sticker: 'StickerIcon',
  Trophy: 'Trophy',
  X: 'X',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ICON: { dark: '#fff', light: '#000' },
  MUTED_FOREGROUND: { dark: '#a1a1a1', light: '#a1a1a1' },
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

const FILE = '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file';

const PACKS: StickerPack[] = [
  {
    id: 'p1',
    title: 'Cats',
    stickers: [
      {
        id: 's1',
        packId: 'p1',
        url: FILE,
        emoji: '🐱',
        width: 200,
        height: 200,
        mime: 'image/png',
      },
    ],
  },
];

const RECENTS: RecentStickerEntry[] = [
  {
    stickerId: 's9',
    packId: 'p9',
    url: FILE,
    emoji: '🔥',
    width: 300,
    height: 200,
    mime: 'image/png',
  },
];

const GIFS = [
  {
    id: 'gif-1',
    title: 'dancing cat',
    url: 'http://127.0.0.1:3188/api/gifs/media/tok-1',
    kind: 'image' as const,
    width: 200,
    height: 150,
  },
];

function sheet(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(EmojiSheet, {
      open: true,
      tab: undefined,
      onSelectTab: () => {},
      gifsVisible: true,
      emojiRecents: ['😀'],
      emojiCategory: undefined,
      onSelectEmojiCategory: () => {},
      onPickEmoji: () => {},
      packs: PACKS,
      panelState: 'ready',
      stickerRecents: RECENTS,
      activePackId: undefined,
      onSelectPack: () => {},
      onPickSticker: () => {},
      onRetryStickers: () => {},
      mockGifItems: GIFS,
      onPickGif: () => {},
      onClose: () => {},
      ...overrides,
    }),
  );
}

describe('EmojiSheet (T-0175)', () => {
  it('shows the three tabs with Emoji first and selected by default', () => {
    const html = sheet();
    const emoji = html.indexOf('>Emoji<');
    const stickers = html.indexOf('>Stickers<');
    const gifs = html.indexOf('>GIFs<');
    expect(emoji).toBeGreaterThanOrEqual(0);
    expect(stickers).toBeGreaterThan(emoji);
    expect(gifs).toBeGreaterThan(stickers);
    expect(html).toContain('Insert 😀');
  });

  it('hides the GIFs tab when the provider is off but keeps the sheet open', () => {
    const html = sheet({ gifsVisible: false });
    expect(html).not.toContain('>GIFs<');
    expect(html).toContain('>Emoji<');
    expect(html).toContain('>Stickers<');
    expect(html).toContain('Insert 😀');
  });

  it('falls back to the first visible tab when GIFs disappear under it', () => {
    expect(resolveSheetTab('gifs', false)).toBe('emoji');
    expect(resolveSheetTab('gifs', true)).toBe('gifs');
    expect(resolveSheetTab('stickers', false)).toBe('stickers');
    expect(resolveSheetTab(undefined, true)).toBe('emoji');
  });

  it('shows the stickers body with the pack strip and the grid', () => {
    const html = sheet({ tab: 'stickers' });
    expect(html).toContain('Recent');
    expect(html).toContain('Cats');
    expect(html).toContain('🔥');
  });

  it('shows the GIFs body with search and trending', () => {
    const html = sheet({ tab: 'gifs' });
    expect(html).toContain('Search GIFs');
    expect(html).toContain('Send dancing cat');
  });

  it('takes about half the screen height', () => {
    const html = sheet();
    expect(html).toContain('h-[50%]');
  });

  it('renders nothing when closed', () => {
    expect(sheet({ open: false })).toBe('');
  });
});

describe('stickerCellSize (T-0175)', () => {
  it('computes 5 equal cells with equal gaps for a 360 px sheet', () => {
    // 360 - 2x16 padding - 4x8 gaps = 296 usable; 296 / 5 = 59 cells.
    expect(stickerCellSize(360)).toBe(59);
    expect(stickerThumbSize(360)).toBe(51);
  });

  it('stays equal on a wider sheet', () => {
    // 400 - 32 - 32 = 336; 336 / 5 = 67 cells.
    expect(stickerCellSize(400)).toBe(67);
    expect(stickerCellSize(400) * 5 + 8 * 4 + 16 * 2).toBeLessThanOrEqual(400);
  });
});
