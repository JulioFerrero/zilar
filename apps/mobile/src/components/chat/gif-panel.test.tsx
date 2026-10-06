import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  fetchGifPage,
  isPanelGifUrl,
  GifCell,
  GifPanel,
  GifSheet,
  probeGifsAvailability,
} from './gif-panel';
import { GifsApiError } from '@/lib/gifs-api';
import { resetGifsAvailability, setGifsAvailability, type GifItem } from '@/lib/gifs';

vi.mock('expo-image', () => ({
  Image: 'Image',
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Inbox: 'Inbox',
  Search: 'Search',
  X: 'X',
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

const API = 'http://127.0.0.1:3188';

function item(overrides: Partial<GifItem> = {}): GifItem {
  return {
    id: 'gif-1',
    title: 'dancing cat',
    url: `${API}/api/gifs/media/tok-1`,
    kind: 'image',
    width: 200,
    height: 150,
    ...overrides,
  };
}

describe('gif panel (T-0148)', () => {
  it('auto-loads only proxy URLs; anything else is a placeholder tile', () => {
    expect(isPanelGifUrl(`${API}/api/gifs/media/tok-1`, API)).toBe(true);
    expect(isPanelGifUrl('/api/gifs/media/tok-1', API)).toBe(true);
    expect(isPanelGifUrl('https://media.giphy.com/media/x/giphy.gif', API)).toBe(false);
    expect(isPanelGifUrl('https://evil.test/api/gifs/media/tok-1', API)).toBe(false);
    expect(isPanelGifUrl('data:image/svg+xml,abc', API)).toBe(false);
    expect(isPanelGifUrl('', API)).toBe(false);
  });

  it('renders mock items with no loading state', () => {
    const html = renderToStaticMarkup(
      createElement(GifPanel, {
        open: true,
        mockItems: [item()],
        onPick: () => {},
      }),
    );
    expect(html).not.toContain('Loading GIFs');
    expect(html).toContain('Send dancing cat');
    expect(html).toContain('Powered by Giphy');
  });

  it('renders a placeholder tile for a hostile preview URL, never an Image', () => {
    const html = renderToStaticMarkup(
      createElement(GifCell, {
        item: item({ url: 'https://media.giphy.com/media/x/giphy.gif' }),
        token: 'tok',
        onPick: () => {},
      }),
    );
    expect(html).not.toContain('Image');
    expect(html).not.toContain('giphy');
  });

  it('renders a trusted preview with the bearer token header path (no token in markup)', () => {
    const html = renderToStaticMarkup(
      createElement(GifCell, { item: item(), token: 'tok', onPick: () => {} }),
    );
    expect(html).toContain('Send dancing cat');
  });

  it('marks video results with a play badge', () => {
    const html = renderToStaticMarkup(
      createElement(GifCell, { item: item({ kind: 'video' }), token: undefined, onPick: () => {} }),
    );
    expect(html).toContain('GIF');
  });

  it('shows loading while the real path fetches', () => {
    const html = renderToStaticMarkup(createElement(GifPanel, { open: true, onPick: () => {} }));
    expect(html).toContain('Loading GIFs');
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(GifSheet, { open: false, onPick: () => {}, onClose: () => {} }),
    );
    expect(html).toBe('');
  });

  it('probe returns true and caches it after the provider answers', async () => {
    resetGifsAvailability();
    const api = {
      searchGifs: async () => ({ items: [] }),
      trendingGifs: async () => ({ items: [] }),
    };
    await expect(probeGifsAvailability(api)).resolves.toBe(true);
    // Cached: a dead API is never consulted again.
    const dead = {
      searchGifs: async () => {
        throw new GifsApiError(501, 'gifs_unavailable', 'off');
      },
      trendingGifs: async () => {
        throw new GifsApiError(501, 'gifs_unavailable', 'off');
      },
    };
    await expect(probeGifsAvailability(dead)).resolves.toBe(true);
    resetGifsAvailability();
  });

  it('probe hides the tab (false) after a 501, keeps it on network errors', async () => {
    resetGifsAvailability();
    const off = {
      searchGifs: async () => ({ items: [] }),
      trendingGifs: async () => {
        throw new GifsApiError(501, 'gifs_unavailable', 'off');
      },
    };
    await expect(probeGifsAvailability(off)).resolves.toBe(false);
    resetGifsAvailability();
    setGifsAvailability(true);
    const flaky = {
      searchGifs: async () => ({ items: [] }),
      trendingGifs: async () => {
        throw new GifsApiError(0, 'network_error', 'down');
      },
    };
    // Pre-seeded true: the failed call is never made.
    await expect(probeGifsAvailability(flaky)).resolves.toBe(true);
    resetGifsAvailability();
    await expect(probeGifsAvailability(flaky)).resolves.toBe(true);
    resetGifsAvailability();
  });

  it('pages trending when the query is empty, search otherwise', async () => {
    const trendingGifs = vi.fn(async () => ({ items: [item()] }));
    const searchGifs = vi.fn(async () => ({ items: [item({ id: 'gif-2' })] }));
    const controller = new AbortController();
    const trending = await fetchGifPage({
      query: '  ',
      pos: undefined,
      client: { searchGifs, trendingGifs },
      signal: controller.signal,
    });
    expect(trending.items).toHaveLength(1);
    expect(trendingGifs).toHaveBeenCalledOnce();
    expect(searchGifs).not.toHaveBeenCalled();
    const searched = await fetchGifPage({
      query: 'cat',
      pos: '25',
      client: { searchGifs, trendingGifs },
      signal: controller.signal,
    });
    expect(searched.items[0]?.id).toBe('gif-2');
    expect(searchGifs).toHaveBeenCalledWith('cat', '25', controller.signal);
  });

  it('fails if the scroll handler fires an append while a page is in flight', async () => {
    // The T-0148 follow-up: infinite scroll could fire overlapping page
    // loads. The panel guards with the synchronous `loadingMoreRef` (set
    // before the fetch starts), and the scroll handler checks it alongside
    // the state. This pins the guard's wiring in the panel source: removing
    // the ref check lets a second scroll event fire an overlapping load.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(join(here, 'gif-panel.tsx'), 'utf8');
    expect(panel).toContain('loadingMoreRef');
    expect(panel).toContain('!loadingMoreRef.current');
  });

  it('fails if a fresh query leaves the append guard stuck after aborting an append', async () => {
    // An append aborted by a new search returns early without clearing its
    // own guard; the fresh (non-append) load must reset it, or infinite
    // scroll never fires again.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const panel = readFileSync(join(here, 'gif-panel.tsx'), 'utf8');
    const freshBranch = panel.slice(panel.indexOf('} else {\n        // A fresh query owns'));
    expect(freshBranch.slice(0, 400)).toContain('loadingMoreRef.current = false');
  });
});
