import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { isPanelStickerUrl, StickerPanel } from './sticker-panel';
import type { RecentStickerEntry, StickerPack } from '@/lib/stickers';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
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

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/stickers-api', () => ({
  createStickersApi: () => ({ listStickerPacks: async () => [] }),
}));

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

function panel(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(StickerPanel, {
      open: true,
      packs: PACKS,
      state: 'ready',
      recents: RECENTS,
      activePackId: undefined,
      onSelectPack: () => {},
      onPick: () => {},
      onRetry: () => {},
      onClose: () => {},
      ...overrides,
    }),
  );
}

describe('StickerPanel', () => {
  it('shows the pack tabs with Recent first and the recents row', () => {
    const html = panel();
    expect(html).toContain('Recent');
    expect(html).toContain('Cats');
    expect(html).toContain('🔥');
  });

  it('shows the stickers of the selected pack', () => {
    const html = panel({ activePackId: 'p1' });
    expect(html).toContain('🐱');
  });

  it('puts the sticker grid in a scroll view so large packs stay reachable', () => {
    const html = panel({ activePackId: 'p1' });
    expect(html).toMatch(/<ScrollView[^>]*accessibilityLabel="Stickers grid"/);
  });

  it('defaults to the first pack when the user has packs but no recents', () => {
    const html = panel({ recents: [], activePackId: undefined });
    expect(html).toContain('🐱');
    expect(html).not.toContain('Create packs on the web for now');
  });

  it('resets a stale pack tab instead of showing the create-on-web copy', () => {
    const html = panel({ activePackId: 'gone' });
    expect(html).toContain('🔥');
    expect(html).not.toContain('Create packs on the web for now');
  });

  it('shows the create-on-web empty state only when the user has no packs at all', () => {
    const html = panel({ packs: [], state: 'empty', recents: [] });
    expect(html).toContain('Create packs on the web for now');
  });

  it('shows loading, error and retry states', () => {
    expect(panel({ packs: undefined, state: 'loading', recents: [] })).toContain(
      'Loading stickers',
    );
    const error = panel({ packs: [], state: 'error', recents: [] });
    expect(error).toContain('Couldn&#x27;t load stickers.');
    expect(error).toContain('Retry');
  });

  it('hides the panel when closed', () => {
    expect(panel({ open: false })).not.toContain('Stickers');
  });
});

describe('isPanelStickerUrl', () => {
  it('allows same-origin file URLs and rejects hostile ones', () => {
    expect(isPanelStickerUrl(FILE, 'http://127.0.0.1:3188')).toBe(true);
    expect(isPanelStickerUrl('https://evil.test/x.webp', 'http://127.0.0.1:3188')).toBe(false);
    expect(isPanelStickerUrl('data:image/svg+xml,hi', 'http://127.0.0.1:3188')).toBe(false);
  });
});
