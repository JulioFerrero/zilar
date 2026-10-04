import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StickerItem, StickerPack } from '@/lib/stickers';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// body is not exported, so the test renders the default export with the auth
// guard and the data hook stubbed. `renderToStaticMarkup` never runs
// effects, so each case forces the body state through the `useState` mock
// (the `machines-screen.test.tsx` pattern): tab from the `'packs'`
// initial, packs and favorites from the array initials in order, status
// from the `'loading'` initial, discover from the first `undefined`
// initial, the four `''` initials (discoverError, query, actionError,
// confirmError) from a queue, and confirming from the second `null`
// initial (busyId stays null).
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  RefreshCw: 'RefreshCw',
  Search: 'Search',
  Star: 'Star',
  Sticker: 'Sticker',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/settings/screen-shell', () => ({
  SettingsScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/stickers/use-stickers-api', () => ({
  useStickersApi: () => ({ api: {}, scenario: null }),
}));

vi.mock('@/components/stickers/require-stickers-auth', () => ({
  RequireStickersAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#ededed', light: '#ededed' },
  FOREGROUND: { dark: '#ededed', light: '#ededed' },
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
  MUTED_FOREGROUND: { dark: '#a1a1a1', light: '#a1a1a1' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

const FILE = '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file';

function pack(id: string, title: string, count = 2): StickerPack {
  return {
    id,
    title,
    stickers: Array.from({ length: count }, (_, index) => ({
      id: `${id}-s${index}`,
      packId: id,
      url: FILE,
      emoji: null,
      width: 200,
      height: 200,
      mime: 'image/png' as const,
    })),
  };
}

const CATS = pack('p-cats', 'Cats');
const MOODS = pack('p-moods', 'Moods', 1);

const FAVORITE: StickerItem = {
  id: 'fav-1',
  packId: 'p-cats',
  url: FILE,
  emoji: null,
  width: 200,
  height: 200,
  mime: 'image/png',
};

type Tab = 'packs' | 'discover' | 'favorites';

let forcedTab: Tab = 'packs';
let forcedPacks: StickerPack[] = [];
let forcedFavorites: StickerItem[] = [];
let forcedStatus: 'loading' | 'ready' | 'error' = 'loading';
let forcedDiscover: StickerPack[] | undefined = undefined;
let forcedStrings: string[] = [];
let forcedConfirming: StickerPack | null = null;
let arrayCursor = 0;
let undefinedCursor = 0;
let stringCursor = 0;
let nullCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      if (initial === 'packs') {
        return [forcedTab as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (Array.isArray(initial)) {
        if (arrayCursor === 0) {
          arrayCursor += 1;
          return [forcedPacks as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
        }
        if (arrayCursor === 1) {
          arrayCursor += 1;
          return [forcedFavorites as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
        }
      }
      if (initial === 'loading') {
        return [forcedStatus as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (initial === undefined && undefinedCursor === 0) {
        undefinedCursor += 1;
        return [forcedDiscover as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (typeof initial === 'string' && initial === '' && stringCursor < forcedStrings.length) {
        const forced = forcedStrings[stringCursor] as unknown as T;
        stringCursor += 1;
        return [forced, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (initial === null && nullCursor === 1) {
        nullCursor += 1;
        return [forcedConfirming as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (initial === null) {
        nullCursor += 1;
      }
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  tab?: Tab;
  packs?: StickerPack[];
  favorites?: StickerItem[];
  status?: 'loading' | 'ready' | 'error';
  discover?: StickerPack[] | undefined;
  strings?: string[];
  confirming?: StickerPack | null;
}): Promise<string> {
  forcedTab = input.tab ?? 'packs';
  forcedPacks = input.packs ?? [];
  forcedFavorites = input.favorites ?? [];
  forcedStatus = input.status ?? 'loading';
  forcedDiscover = input.discover;
  forcedStrings = input.strings ?? [];
  forcedConfirming = input.confirming ?? null;
  arrayCursor = 0;
  undefinedCursor = 0;
  stringCursor = 0;
  nullCursor = 0;
  try {
    const module = await import('@/app/settings/stickers');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedTab = 'packs';
    forcedPacks = [];
    forcedFavorites = [];
    forcedStatus = 'loading';
    forcedDiscover = undefined;
    forcedStrings = [];
    forcedConfirming = null;
  }
}

describe('StickersScreen', () => {
  it('shows loading while the packs load', async () => {
    const html = await renderScreen({ status: 'loading' });
    expect(html).toContain('Loading stickers…');
  });

  it('shows the load error with Retry', async () => {
    const html = await renderScreen({ status: 'error' });
    expect(html).toContain('Could not load your stickers.');
    expect(html).toContain('Retry loading stickers');
  });

  it('lists the panel packs with Remove and move buttons', async () => {
    const html = await renderScreen({ packs: [CATS, MOODS], status: 'ready' });
    expect(html).toContain('My packs');
    expect(html).toContain('Cats');
    expect(html).toContain('2 stickers');
    expect(html).toContain('1 sticker');
    expect(html).toContain('Remove Cats');
    expect(html).toContain('Move Cats up');
    expect(html).toContain('Move Moods down');
  });

  it('renders the My packs Remove on the second line, after the move buttons', async () => {
    const html = await renderScreen({ packs: [CATS], status: 'ready' });
    const moveUp = html.indexOf('Move Cats up');
    const remove = html.indexOf('Remove Cats');
    expect(moveUp).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(moveUp);
  });

  it('shows the empty packs state with Open Discover', async () => {
    const html = await renderScreen({ packs: [], status: 'ready' });
    expect(html).toContain('No packs on your panel yet.');
    expect(html).toContain('Open Discover');
  });

  it('shows the action error above the list', async () => {
    const html = await renderScreen({
      packs: [CATS],
      status: 'ready',
      strings: ['', '', 'Could not reorder your packs. Try again.', ''],
    });
    expect(html).toContain('Could not reorder your packs. Try again.');
  });

  it('shows the remove confirm with the pack title', async () => {
    const html = await renderScreen({ packs: [CATS], status: 'ready', confirming: CATS });
    expect(html).toContain('Remove this pack?');
    expect(html).toContain('Cats leaves your sticker panel.');
  });

  it('lists discover packs with Add for new packs and Remove for added ones', async () => {
    const html = await renderScreen({
      tab: 'discover',
      packs: [CATS],
      status: 'ready',
      discover: [CATS, MOODS],
    });
    expect(html).toContain('Find shared packs from anyone on this server');
    expect(html).toContain('Search sticker packs');
    expect(html).toContain('Add Moods');
    expect(html).toContain('Remove Cats');
  });

  it('shows the discover empty and error states', async () => {
    const empty = await renderScreen({ tab: 'discover', status: 'ready', discover: [] });
    expect(empty).toContain('No shared packs found. Try another search.');
    const failed = await renderScreen({
      tab: 'discover',
      status: 'ready',
      discover: [],
      strings: ['Could not load shared packs.'],
    });
    expect(failed).toContain('Could not load shared packs.');
  });

  it('shows Retry after the first Discover load fails, not a spinner', async () => {
    // The real failure path: `discover` stays undefined (never set),
    // `discoverBusy` settles back to false, `discoverError` is set.
    const html = await renderScreen({
      tab: 'discover',
      status: 'ready',
      strings: ['Could not load shared packs.'],
    });
    expect(html).toContain('Could not load shared packs.');
    expect(html).toContain('Retry loading shared packs');
    expect(html).not.toContain('Searching…');
  });

  it('shows the favorites grid with a remove control', async () => {
    const html = await renderScreen({ tab: 'favorites', status: 'ready', favorites: [FAVORITE] });
    expect(html).toContain('Favorites');
    expect(html).toContain('Favorite stickers');
    expect(html).toContain('Remove favorite');
  });

  it('shows the favorites empty state', async () => {
    const html = await renderScreen({ tab: 'favorites', status: 'ready', favorites: [] });
    expect(html).toContain('No favorites yet. Starred stickers show up here.');
  });

  it('shows the favorite action error', async () => {
    const html = await renderScreen({
      tab: 'favorites',
      status: 'ready',
      favorites: [FAVORITE],
      strings: ['', '', 'Could not remove the favorite. Try again.', ''],
    });
    expect(html).toContain('Could not remove the favorite. Try again.');
  });
});
