import { createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { formErrorFor } from '@/components/stickers/pack-editor';
import type { StickerItem, StickerPack } from '@/lib/stickers';

// Settings → sticker pack editor (`app/settings/sticker-pack.tsx`) as a
// screen. The body calls `useState` twenty times in a fixed order (status,
// title, initialTitle, visibility, initialVisibility, importedFrom, saved,
// removedIds, fresh, preparing, skippedNote, formError, saving, progress,
// token, confirmingDelete, deleteError, deleting, discardAsk, createdPackId).
// `renderToStaticMarkup` never runs effects, so each render forces those
// values by call index and every setter records what it was given in
// `setterLog`. The Button, Pressable and ConfirmDialog mocks record their
// `onPress`/`onConfirm`, so a test can press a control and check the API
// calls, the navigation and the messages the editor sets.

vi.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    focusCallback = callback;
  },
  useRouter: () => ({
    back: () => {
      backCalls += 1;
    },
    push: () => {},
  }),
  useLocalSearchParams: () => forcedParams,
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
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
  Circle: 'Circle',
  CircleAlert: 'CircleAlert',
  CircleDot: 'CircleDot',
  Globe: 'Globe',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Inbox: 'Inbox',
  Lock: 'Lock',
  RefreshCw: 'RefreshCw',
  Trash2: 'Trash2',
  TriangleAlert: 'TriangleAlert',
  X: 'X',
}));

vi.mock('@/components/ui/button', () => ({
  Button: (props: CaptureProps) => capture(props, 'Button'),
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/auth/session', () => ({
  useAuthStore: () => forcedMe,
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

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: { dark: '#ededed', light: '#ededed' },
  ACCENT_FOREGROUND: { dark: '#0a0a0a', light: '#0a0a0a' },
  DANGER: '#ef4444',
  FOREGROUND: { dark: '#ededed', light: '#ededed' },
  ICON: { dark: '#d4d4d4', light: '#d4d4d4' },
  MUTED_FOREGROUND: { dark: '#a1a1a1', light: '#a1a1a1' },
}));

vi.mock('@/lib/color-scheme', () => ({
  asColorScheme: () => 'dark',
}));

vi.mock('@/lib/depth', () => ({
  well: {},
  primaryKey: {},
  KEY_PRIMARY_PRESSED_SHADOW: '0 0 #000',
  pressStyle: () => undefined,
}));

vi.mock('@/components/stickers/sticker-native', () => ({
  STICKER_PREP_MAX_BYTES: 524288,
  createStickerImagePicker: () => ({
    pickImages: async () => ({ status: 'cancelled' as const }),
  }),
  createStickerPreparer: () => ({ prepare: async () => ({ status: 'cancelled' }) }),
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

interface Forced {
  status?: string;
  title?: string;
  initialTitle?: string;
  visibility?: 'private' | 'server';
  importedFrom?: string;
  saved?: StickerItem[];
  createdPackId?: string;
}

type ParamsValue = { id?: string };

const handlers = new Map<string, () => void>();
const dialogs = new Map<string, DialogProps>();
let focusCallback: (() => void) | undefined;
let backCalls = 0;
let forcedParams: ParamsValue = {};
let forcedMe: { id: string } | null = { id: 'me-1' };
let forcedApi: Record<string, unknown> = {};
let stateValues: unknown[] = [];
let stateCursor = 0;
let setterLog: unknown[] = [];

function capture(props: CaptureProps, tag: string) {
  if (props.accessibilityLabel !== undefined && props.onPress !== undefined) {
    handlers.set(props.accessibilityLabel, props.onPress);
  }
  return createElement(tag, { accessibilityLabel: props.accessibilityLabel }, props.children);
}

const FILE = '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file';

function sticker(id: string, packId: string, emoji: string | null = null): StickerItem {
  return { id, packId, url: FILE, emoji, width: 200, height: 200, mime: 'image/png' };
}

const OWN_PACK: StickerPack = {
  id: 'pack-own',
  ownerId: 'me-1',
  title: 'Mine',
  visibility: 'private',
  stickers: [sticker('s-1', 'pack-own', '🐱'), sticker('s-2', 'pack-own')],
};

// The twenty initial values of the body's `useState` calls, in call order.
function bodyState(state: Forced): unknown[] {
  const title = state.title ?? '';
  const visibility = state.visibility ?? 'private';
  return [
    state.status ?? 'ready',
    title,
    state.initialTitle ?? title,
    visibility,
    visibility,
    state.importedFrom,
    state.saved ?? [],
    [],
    [],
    0,
    false,
    '',
    false,
    undefined,
    undefined,
    false,
    '',
    false,
    false,
    state.createdPackId,
  ];
}

async function renderEditor(params: ParamsValue, state: Forced): Promise<string> {
  forcedParams = params;
  stateValues = bodyState(state);
  stateCursor = 0;
  setterLog = [];
  handlers.clear();
  dialogs.clear();
  focusCallback = undefined;
  backCalls = 0;
  const module = await import('@/app/settings/sticker-pack');
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

describe('Settings → sticker pack editor', () => {
  it('shows an existing pack with its stickers and the delete control', async () => {
    const markup = await renderEditor(
      { id: 'pack-own' },
      { title: 'Mine', saved: OWN_PACK.stickers },
    );
    expect(markup).toContain('Pack name');
    expect(markup).toContain('2 / 120');
    expect(markup).toContain('Remove sticker');
    expect(markup).toContain('Delete pack');
  });

  it('shows the create form without a delete control', async () => {
    const markup = await renderEditor({}, { title: '' });
    expect(markup).toContain('Create pack');
    expect(markup).toContain('Pick PNG, JPEG, WebP or GIF images.');
    expect(markup).not.toContain('Delete pack');
  });

  it('shows the loading message while the pack loads', async () => {
    const markup = await renderEditor({ id: 'pack-own' }, { status: 'loading' });
    expect(markup).toContain('Loading pack…');
  });

  it('marks a pack that is not on the panel as not found', async () => {
    forcedApi = { listStickerPacks: async () => [] };
    await renderEditor({ id: 'pack-x' }, { status: 'loading' });
    focusCallback?.();
    await settle();
    expect(setterLog).toContain('not-found');
  });

  it('marks a pack owned by someone else as forbidden', async () => {
    forcedApi = { listStickerPacks: async () => [{ ...OWN_PACK, ownerId: 'other' }] };
    await renderEditor({ id: 'pack-own' }, { status: 'loading' });
    focusCallback?.();
    await settle();
    expect(setterLog).toContain('forbidden');
  });

  it('shows the load error when the panel cannot be read', async () => {
    forcedApi = {
      listStickerPacks: async () => {
        throw new Error('offline');
      },
    };
    await renderEditor({ id: 'pack-own' }, { status: 'loading' });
    focusCallback?.();
    await settle();
    expect(setterLog).toContain('load-error');
  });

  it('saves a renamed pack with the title patch and goes back', async () => {
    const patch = vi.fn(async () => ({}));
    forcedApi = { patchStickerPack: patch };
    await renderEditor(
      { id: 'pack-own' },
      { title: 'Renamed', initialTitle: 'Mine', saved: OWN_PACK.stickers },
    );
    press('Save');
    await settle();
    expect(patch).toHaveBeenCalledWith('pack-own', { title: 'Renamed', visibility: 'private' });
    expect(backCalls).toBe(1);
  });

  it('refuses a blank name before any request', async () => {
    const patch = vi.fn(async () => ({}));
    forcedApi = { patchStickerPack: patch };
    await renderEditor(
      { id: 'pack-own' },
      { title: '   ', initialTitle: 'Mine', saved: OWN_PACK.stickers },
    );
    press('Save');
    await settle();
    expect(setterLog).toContain('Name the pack first.');
    expect(patch).not.toHaveBeenCalled();
  });

  it('refuses to create a pack without a sticker', async () => {
    const create = vi.fn(async () => ({ id: 'new' }));
    forcedApi = { createStickerPack: create };
    await renderEditor({}, { title: 'New' });
    press('Create pack');
    await settle();
    expect(setterLog).toContain('Add at least one sticker first.');
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the editor open with the message when the save fails', async () => {
    forcedApi = {
      patchStickerPack: async () => {
        throw new Error('boom');
      },
    };
    await renderEditor(
      { id: 'pack-own' },
      { title: 'Renamed', initialTitle: 'Mine', saved: OWN_PACK.stickers },
    );
    press('Save');
    await settle();
    expect(setterLog).toContain(formErrorFor(new Error('boom')));
    expect(backCalls).toBe(0);
  });

  it('deletes the pack after the confirmation and goes back', async () => {
    const remove = vi.fn(async () => ({ warning: '' }));
    forcedApi = { deleteStickerPack: remove };
    await renderEditor({ id: 'pack-own' }, { title: 'Mine', saved: OWN_PACK.stickers });
    dialogs.get('Delete this pack?')?.onConfirm();
    await settle();
    expect(remove).toHaveBeenCalledWith('pack-own');
    expect(backCalls).toBe(1);
  });

  it('keeps the delete dialog open with the message when the delete fails', async () => {
    forcedApi = {
      deleteStickerPack: async () => {
        throw new Error('boom');
      },
    };
    await renderEditor({ id: 'pack-own' }, { title: 'Mine', saved: OWN_PACK.stickers });
    dialogs.get('Delete this pack?')?.onConfirm();
    await settle();
    expect(setterLog).toContain('Could not delete the pack. Try again.');
    expect(backCalls).toBe(0);
  });

  it('asks before leaving with unsaved changes', async () => {
    await renderEditor(
      { id: 'pack-own' },
      { title: 'Renamed', initialTitle: 'Mine', saved: OWN_PACK.stickers },
    );
    press('Cancel');
    expect(setterLog).toContain(true);
    expect(backCalls).toBe(0);
  });
});
