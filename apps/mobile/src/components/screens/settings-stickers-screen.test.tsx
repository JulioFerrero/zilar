import { createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StickerItem, StickerPack } from '@/lib/stickers';

// Settings → Stickers (`app/settings/stickers.tsx`) as a screen. The body
// calls `useState` fifteen times in a fixed order (tab, packs, favorites,
// status, discover, discoverBusy, discoverError, query, actionError, busyId,
// confirming, confirmError, importOpen, importNonce, token). `renderToStaticMarkup`
// never runs effects, so each render forces those values by call index and
// every setter records what it was given in `setterLog`. The Button, Pressable
// and ConfirmDialog mocks record their `onPress`/`onConfirm`, so a test can
// press a control and check the API calls and the messages the screen sets.

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    focusCallback = callback;
  },
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: (props: CaptureProps) => capture(props, 'Pressable'),
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  CircleAlert: 'CircleAlert',
  Clock: 'Clock',
  Download: 'Download',
  Inbox: 'Inbox',
  Info: 'Info',
  Pencil: 'Pencil',
  Plus: 'Plus',
  RefreshCw: 'RefreshCw',
  Search: 'Search',
  Star: 'Star',
  Sticker: 'Sticker',
  X: 'X',
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: CaptureProps) => capture(props, 'Button'),
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: (props: DialogProps) => {
    dialogs.set(props.title, props);
    return props.visible ? createElement('Text', null, props.title, props.message) : null;
  },
}));

vi.mock('@/components/settings/screen-shell', () => ({
  SettingsScreenShell: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/stickers/use-stickers-api', () => ({
  useStickersApi: () => ({ api: forcedApi, scenario: null }),
}));

vi.mock('@/components/stickers/require-stickers-auth', () => ({
  RequireStickersAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/stickers/telegram-import-sheet', () => ({
  TelegramImportSheet: () => null,
}));

vi.mock('@/auth/session', () => ({
  useAuthStore: () => ({ id: 'me-1' }),
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: '#ededed',
  ACCENT_FOREGROUND: '#0a0a0a',
  DANGER: { dark: '#dc2626', light: '#dc2626' },
  FOREGROUND: '#ededed',
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial?: unknown) => {
      const index = stateCursor;
      stateCursor += 1;
      if (index < stateValues.length) {
        return [
          stateValues[index],
          (next: unknown) => {
            setterLog.push(next);
          },
        ];
      }
      return actual.useState(initial as never);
    },
  };
});

interface CaptureProps {
  accessibilityLabel?: string;
  onPress?: () => void;
  children?: ReactNode;
}

interface DialogProps {
  visible: boolean;
  title: string;
  message: string;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const handlers = new Map<string, () => void>();
const dialogs = new Map<string, DialogProps>();
let focusCallback: (() => void) | undefined;
let stateValues: unknown[] = [];
let stateCursor = 0;
let setterLog: unknown[] = [];
let forcedApi: Record<string, unknown> = {};

function capture(props: CaptureProps, tag: string) {
  if (props.accessibilityLabel !== undefined && props.onPress !== undefined) {
    handlers.set(props.accessibilityLabel, props.onPress);
  }
  return createElement(tag, { accessibilityLabel: props.accessibilityLabel }, props.children);
}

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

interface BodyState {
  tab?: string;
  packs?: StickerPack[];
  favorites?: StickerItem[];
  status?: string;
  discover?: StickerPack[];
  actionError?: string;
  confirming?: StickerPack | null;
}

// The fifteen initial values of the body's `useState` calls, in call order.
function bodyState(state: BodyState): unknown[] {
  return [
    state.tab ?? 'packs',
    state.packs ?? [],
    state.favorites ?? [],
    state.status ?? 'ready',
    state.discover,
    false,
    '',
    '',
    state.actionError ?? '',
    null,
    state.confirming ?? null,
    '',
    false,
    0,
    undefined,
  ];
}

async function renderScreen(state: BodyState): Promise<string> {
  stateValues = bodyState(state);
  stateCursor = 0;
  setterLog = [];
  handlers.clear();
  dialogs.clear();
  focusCallback = undefined;
  const module = await import('@/app/settings/stickers');
  return renderToStaticMarkup(createElement(module.default));
}

// Lets the Effect fibers started by a press or a focus run to the end.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function press(label: string): void {
  const handler = handlers.get(label);
  if (handler === undefined) {
    throw new Error(`no control labelled ${label}`);
  }
  handler();
}

describe('Settings → Stickers screen', () => {
  it('shows the loading message until the packs arrive', async () => {
    const markup = await renderScreen({ status: 'loading' });
    expect(markup).toContain('Loading stickers…');
  });

  it('lists the panel packs in order with move and remove controls', async () => {
    const markup = await renderScreen({ packs: [CATS, MOODS] });
    expect(markup).toContain('Cats');
    expect(markup).toContain('2 stickers');
    expect(markup).toContain('Moods');
    expect(markup).toContain('1 sticker');
    expect(markup).toContain('Move Cats down');
    expect(markup).toContain('Remove Moods');
  });

  it('explains an empty panel and offers Discover', async () => {
    const markup = await renderScreen({ packs: [] });
    expect(markup).toContain(
      'No packs on your panel yet. Look in Discover for shared packs to add.',
    );
    expect(markup).toContain('Open Discover');
  });

  it('shows the starred stickers on the Favorites tab', async () => {
    const markup = await renderScreen({ tab: 'favorites', favorites: [FAVORITE] });
    expect(markup).toContain('Favorite stickers');
    expect(markup).toContain('Remove favorite');
  });

  it('shows the load error with a retry', async () => {
    const markup = await renderScreen({ status: 'error' });
    expect(markup).toContain('Could not load your stickers.');
    expect(markup).toContain('Retry loading stickers');
  });

  it('shows the error when loading the panel fails', async () => {
    forcedApi = {
      listStickerPacks: vi.fn(async () => {
        throw new Error('offline');
      }),
      listStickerFavorites: vi.fn(async () => []),
    };
    await renderScreen({ packs: [CATS] });
    focusCallback?.();
    await settle();
    expect(setterLog).toContain('error');
  });

  it('removes a favorite and sends the sticker id', async () => {
    const removeFavorite = vi.fn(async () => undefined);
    forcedApi = { removeStickerFavorite: removeFavorite };
    await renderScreen({ tab: 'favorites', favorites: [FAVORITE] });
    press('Remove favorite');
    await settle();
    expect(removeFavorite).toHaveBeenCalledWith('fav-1');
  });

  it('shows the favorite error when removing a favorite fails', async () => {
    forcedApi = {
      removeStickerFavorite: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await renderScreen({ tab: 'favorites', favorites: [FAVORITE] });
    press('Remove favorite');
    await settle();
    expect(setterLog).toContain('Could not remove the favorite. Try again.');
  });

  it('moves a pack up and saves the new order', async () => {
    const reorder = vi.fn(async () => undefined);
    forcedApi = { reorderStickerPanelPacks: reorder };
    await renderScreen({ packs: [CATS, MOODS] });
    press('Move Moods up');
    await settle();
    expect(reorder).toHaveBeenCalledWith(['p-moods', 'p-cats']);
  });

  it('shows the reorder error when the new order is not saved', async () => {
    forcedApi = {
      reorderStickerPanelPacks: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await renderScreen({ packs: [CATS, MOODS] });
    press('Move Moods up');
    await settle();
    expect(setterLog).toContain('Could not reorder your packs. Try again.');
  });

  it('removes a pack after the confirmation and reloads the panel', async () => {
    const removePack = vi.fn(async () => ({ warning: '' }));
    const listPacks = vi.fn(async () => [MOODS]);
    forcedApi = { removeStickerPanelPack: removePack, listStickerPacks: listPacks };
    await renderScreen({ packs: [CATS, MOODS], confirming: CATS });
    dialogs.get('Remove this pack?')?.onConfirm();
    await settle();
    expect(removePack).toHaveBeenCalledWith('p-cats');
    expect(listPacks).toHaveBeenCalled();
  });

  it('keeps the confirmation open with the message when the removal fails', async () => {
    forcedApi = {
      removeStickerPanelPack: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await renderScreen({ packs: [CATS, MOODS], confirming: CATS });
    dialogs.get('Remove this pack?')?.onConfirm();
    await settle();
    expect(setterLog).toContain('Could not remove the pack. Try again.');
  });

  it('adds a shared pack to the panel and reloads it', async () => {
    const addPack = vi.fn(async () => ({ id: 'p-moods' }));
    const listPacks = vi.fn(async () => [CATS, MOODS]);
    forcedApi = { addStickerPanelPack: addPack, listStickerPacks: listPacks };
    await renderScreen({ tab: 'discover', packs: [CATS], discover: [MOODS] });
    press('Add Moods');
    await settle();
    expect(addPack).toHaveBeenCalledWith('p-moods');
    expect(listPacks).toHaveBeenCalled();
  });

  it('shows the add error when the pack cannot be added', async () => {
    forcedApi = {
      addStickerPanelPack: vi.fn(async () => {
        throw new Error('boom');
      }),
      listStickerPacks: vi.fn(async () => [CATS]),
    };
    await renderScreen({ tab: 'discover', packs: [CATS], discover: [MOODS] });
    press('Add Moods');
    await settle();
    expect(setterLog).toContain('Could not add the pack. Try again.');
  });
});
