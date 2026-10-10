import { createElement } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StickerItem, StickerPack } from '@/lib/stickers';

// The editor screen renders `sticker-pack.tsx` through the same `useState`
// forcing pattern as `stickers-screen.test.tsx`: `renderToStaticMarkup`
// never runs effects, so each case forces the body state through the
// `useState` mock (title from the first `''` initial, visibility from the
// first `'private'` initial, saved from the first array initial, removedIds
// and fresh from the next two, preparing/formError/deleteError from the
// next `''`/`0` initials, and status/visibility-imported flags below).
vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
  useLocalSearchParams: () => forcedParams,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => {
    if (accessibilityLabel === 'Add sticker images' && onPress !== undefined) {
      capturedAddPress = onPress;
    }
    return createElement('Pressable', { accessibilityLabel }, children);
  },
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
  ConfirmDialog: ({
    visible,
    title,
    message,
    error,
    confirmAccessibilityLabel,
  }: {
    visible: boolean;
    title: string;
    message: string;
    error?: string;
    confirmAccessibilityLabel?: string;
  }) =>
    visible
      ? createElement('Text', null, title, message, error ?? '', confirmAccessibilityLabel ?? '')
      : null,
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
  ACCENT: '#ededed',
  ACCENT_FOREGROUND: '#0a0a0a',
  DANGER: '#ef4444',
  FOREGROUND: '#ededed',
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
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
    pickImages: async () => {
      const current = globalThis.__forcedPickerResult;
      return current ?? { status: 'cancelled' as const };
    },
  }),
  createStickerPreparer: () => ({ prepare: async () => ({ status: 'cancelled' }) }),
}));

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

let forcedParams: { id?: string } = {};
let forcedMe: { id: string } | null = { id: 'me-1' };
let forcedApi: Record<string, (...args: never[]) => Promise<never>> = {};
let forcedPickerResult:
  | { status: 'picked'; images: Array<{ uri: string; width: number; height: number }> }
  | { status: 'cancelled' }
  | { status: 'error'; message: string } = { status: 'cancelled' };
// `vi.mock` factories are hoisted above the module scope, so the picker
// seam cannot close over `forcedPickerResult` directly; each render syncs
// it onto `globalThis` and the factory reads it back at call time.
declare global {
  // eslint-disable-next-line no-var
  var __forcedPickerResult:
    | { status: 'picked'; images: Array<{ uri: string; width: number; height: number }> }
    | { status: 'cancelled' }
    | { status: 'error'; message: string }
    | undefined;
}
function syncPickerResult(): void {
  globalThis.__forcedPickerResult = forcedPickerResult;
}
let capturedAddPress: (() => void) | undefined = undefined;
let forcedStatus = 'ready';
let forcedTitle = '';
let forcedVisibility: 'private' | 'server' = 'private';
let forcedImportedFrom: string | undefined = undefined;
let forcedImportedUsed = false;
let forcedSaved: StickerItem[] = [];
let forcedFresh: Array<{
  key: string;
  uri: string;
  mimeType: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  emoji: string;
  status: 'ready' | 'uploading' | 'uploaded' | 'failed-prepare' | 'uploadFailed';
  error?: string | undefined;
}> = [];
let forcedFormError = '';
let observedFormError = '';
let forcedSaving = false;
let forcedConfirmingDelete = false;
let forcedDeleteError = '';
let statusCursor = 0;
let stringCursor = 0;
let arrayCursor = 0;
let boolCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  type AnyState<T> = [T, Dispatch<SetStateAction<T>>];
  function forced(initial: unknown, value: unknown): AnyState<never> {
    void initial;
    return [value, (() => {}) as Dispatch<SetStateAction<never>>] as AnyState<never>;
  }
  return {
    ...actual,
    useState: ((initial: unknown): unknown => {
      // Order in the screen: status, title, initialTitle, visibility,
      // initialVisibility, importedFrom, saved, removedIds, fresh, preparing,
      // skippedNote, formError, saving, progress, token, confirmingDelete,
      // deleteError, deleting, discardAsk.
      if (initial === 'loading' || initial === 'ready') {
        statusCursor += 1;
        if (statusCursor === 1) {
          return forced(initial, forcedStatus);
        }
        return actual.useState(initial as never);
      }
      if (typeof initial === 'string') {
        if (initial === '') {
          stringCursor += 1;
          if (stringCursor === 1) return forced(initial, forcedTitle);
          if (stringCursor === 2) return forced(initial, forcedTitle);
          // The form error state is real so the Add handler's
          // `setFormError(result.message)` lands in React state; the
          // wrapper observes it for the picker-error assertions below.
          if (stringCursor === 3) {
            const [value, setValue] = actual.useState(forcedFormError);
            const observed = ((next: SetStateAction<string>) => {
              observedFormError =
                typeof next === 'function'
                  ? (next as (previous: string) => string)(observedFormError)
                  : next;
              (setValue as Dispatch<SetStateAction<string>>)(next as string);
            }) as unknown as Dispatch<SetStateAction<never>>;
            return [value, observed] as unknown;
          }
          if (stringCursor === 4) return forced(initial, forcedDeleteError);
        }
        if (initial === 'private') {
          return forced(initial, forcedVisibility);
        }
        return actual.useState(initial as never);
      }
      if (initial === undefined) {
        if (!forcedImportedUsed) {
          forcedImportedUsed = true;
          return forced(initial, forcedImportedFrom);
        }
        return actual.useState(initial as never);
      }
      if (Array.isArray(initial)) {
        arrayCursor += 1;
        if (arrayCursor === 1) return forced(initial, forcedSaved);
        if (arrayCursor === 2) return forced(initial, []);
        if (arrayCursor === 3) return forced(initial, forcedFresh);
        return actual.useState(initial as never);
      }
      if (typeof initial === 'number') {
        return actual.useState(initial as never);
      }
      if (typeof initial === 'boolean') {
        boolCursor += 1;
        // skippedNote, saving, confirmingDelete, deleting, discardAsk.
        if (boolCursor === 2) {
          return forced(initial, forcedSaving);
        }
        if (boolCursor === 3) {
          return forced(initial, forcedConfirmingDelete);
        }
        return actual.useState(initial as never);
      }
      return actual.useState(initial as never);
    }) as typeof actual.useState,
  };
});

async function renderEditor(input?: {
  params?: { id?: string };
  status?: string;
  title?: string;
  visibility?: 'private' | 'server';
  importedFrom?: string | undefined;
  saved?: StickerItem[];
  fresh?: typeof forcedFresh;
  formError?: string;
  saving?: boolean;
  confirmingDelete?: boolean;
  deleteError?: string;
}): Promise<string> {
  forcedParams = input?.params ?? {};
  forcedStatus = input?.status ?? 'ready';
  forcedTitle = input?.title ?? '';
  forcedVisibility = input?.visibility ?? 'private';
  forcedImportedFrom = input?.importedFrom;
  forcedSaved = input?.saved ?? [];
  forcedFresh = input?.fresh ?? [];
  forcedFormError = input?.formError ?? '';
  observedFormError = input?.formError ?? '';
  forcedSaving = input?.saving ?? false;
  forcedConfirmingDelete = input?.confirmingDelete ?? false;
  forcedDeleteError = input?.deleteError ?? '';
  syncPickerResult();
  statusCursor = 0;
  stringCursor = 0;
  arrayCursor = 0;
  boolCursor = 0;
  forcedImportedUsed = false;
  capturedAddPress = undefined;
  try {
    const module = await import('@/app/settings/sticker-pack');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedParams = {};
    forcedStatus = 'ready';
    forcedTitle = '';
    forcedVisibility = 'private';
    forcedImportedFrom = undefined;
    forcedSaved = [];
    forcedFresh = [];
    forcedFormError = '';
    forcedSaving = false;
    forcedConfirmingDelete = false;
    forcedDeleteError = '';
  }
}

const PICKER_DENIED =
  'Zilar needs access to your photos to add stickers. You can allow it in Settings.';

describe('StickerPackScreen', () => {
  it('shows the create frame with the name field and the add tile', async () => {
    const html = await renderEditor({ title: '' });
    expect(html).toContain('Pack name');
    expect(html).toContain('Add sticker images');
    expect(html).toContain('Pick PNG, JPEG, WebP or GIF images.');
    expect(html).toContain('Create pack');
    expect(html).not.toContain('Delete Mine');
  });

  it('shows the loading and load-error states', async () => {
    expect(await renderEditor({ status: 'loading' })).toContain('Loading pack…');
    const failed = await renderEditor({ status: 'load-error' });
    expect(failed).toContain('Could not load this pack.');
    expect(failed).toContain('Retry loading pack');
  });

  it('shows the not-found and forbidden sentences', async () => {
    expect(await renderEditor({ status: 'not-found' })).toContain('This pack was not found.');
    const forbidden = await renderEditor({ status: 'forbidden' });
    expect(forbidden).toContain('You can only edit your own packs.');
    expect(forbidden).toContain('Back to stickers');
  });

  it('shows the edit frame with the visibility rows and the delete section', async () => {
    const html = await renderEditor({
      params: { id: 'pack-own' },
      title: 'Mine',
      visibility: 'private',
      saved: OWN_PACK.stickers,
    });
    expect(html).toContain('Who can find this pack');
    expect(html).toContain('Shared on this server');
    expect(html).toContain('Delete pack');
    expect(html).toContain('2 / 120');
    expect(html).toContain('Remove sticker');
  });

  it('locks visibility for imported packs', async () => {
    const html = await renderEditor({
      params: { id: 'pack-own' },
      title: 'Mine',
      importedFrom: 'telegram:cats',
      saved: OWN_PACK.stickers,
    });
    expect(html).toContain('Imported packs are for personal use');
  });

  it('shows a failed row with Retry and the form error', async () => {
    const html = await renderEditor({
      title: 'Mine',
      fresh: [
        {
          key: 'n-1',
          uri: 'file:///cache/a.webp',
          mimeType: 'image/webp',
          width: 512,
          height: 380,
          bytes: 94 * 1024,
          emoji: '',
          status: 'uploadFailed',
          error: 'The upload failed. Try again.',
        },
      ],
      formError: 'Retry or remove the failed stickers first.',
    });
    expect(html).toContain('The upload failed. Try again.');
    expect(html).toContain('Retry');
    expect(html).toContain('Retry or remove the failed stickers first.');
  });

  it('shows the picker denied sentence after Add fails', async () => {
    forcedPickerResult = { status: 'error', message: PICKER_DENIED };
    await renderEditor({ title: 'Mine' });
    const press = capturedAddPress;
    const observedBefore = observedFormError;
    forcedPickerResult = { status: 'cancelled' };
    capturedAddPress = undefined;
    expect(press).toBeDefined();
    expect(observedBefore).toBe('');
    press?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The Add handler routes the picker's error message into the form
    // error state; the setter the screen holds is a forced no-op, so the
    // wrapper records it and a second render reads it back as HTML.
    const html = await renderEditor({ title: 'Mine', formError: observedFormError });
    expect(observedFormError).toBe(PICKER_DENIED);
    expect(html).toContain(PICKER_DENIED);
  });

  it('shows no form sentence when the picker is cancelled', async () => {
    forcedPickerResult = { status: 'cancelled' };
    await renderEditor({ title: 'Mine' });
    const press = capturedAddPress;
    capturedAddPress = undefined;
    expect(press).toBeDefined();
    press?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const html = await renderEditor({ title: 'Mine', formError: observedFormError });
    expect(observedFormError).toBe('');
    expect(html).not.toContain(PICKER_DENIED);
  });

  it('shows Saving while the save runs', async () => {
    const html = await renderEditor({ title: 'Mine', saving: true });
    expect(html).toContain('Saving…');
  });

  it('shows the verbatim delete warning in the confirm modal', async () => {
    const html = await renderEditor({
      params: { id: 'pack-own' },
      title: 'Mine',
      visibility: 'private',
      saved: OWN_PACK.stickers,
      confirmingDelete: true,
    });
    expect(html).toContain('Delete this pack?');
    expect(html).toContain(
      'The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker.',
    );
    expect(html).toContain('Delete Mine');
  });

  it('keeps the delete modal open with the fixed sentence on failure', async () => {
    const html = await renderEditor({
      params: { id: 'pack-own' },
      title: 'Mine',
      visibility: 'private',
      saved: OWN_PACK.stickers,
      confirmingDelete: true,
      deleteError: 'Could not delete the pack. Try again.',
    });
    expect(html).toContain('Delete this pack?');
    expect(html).toContain('Could not delete the pack. Try again.');
  });
});
