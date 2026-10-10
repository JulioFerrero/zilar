import { createElement } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { StickersApiError, type TelegramImportResult } from '@/lib/stickers-api';
import { flushTasks as flush } from '@/test/wait';

// The sheet is rendered with `renderToStaticMarkup` (effects never run), so
// each case forces the sheet state through the `useState` mock, in hook
// order: input (first `''`), busy (first `false`), error (second `''`),
// result (first `null`), special (second `null`). The error state stays real
// with an observed setter so the empty-input and refusal flows assert the
// sentence the sheet shows.

const pressed: Record<string, Array<() => void>> = {};

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => children,
  Modal: ({ children }: { children: ReactNode }) => children,
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
    if (accessibilityLabel !== undefined && onPress !== undefined) {
      const list = pressed[accessibilityLabel] ?? [];
      list.push(onPress);
      pressed[accessibilityLabel] = list;
    }
    return createElement('Pressable', { accessibilityLabel }, children);
  },
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));

vi.mock('lucide-react-native', () => ({
  Clock: 'Clock',
  Info: 'Info',
  X: 'X',
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: '#ededed',
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
}));

vi.mock('@/lib/depth', () => ({
  well: {},
  primaryKey: {},
  KEY_PRIMARY_PRESSED_SHADOW: '0 0 #000',
  pressStyle: () => undefined,
}));

let forcedInput = '';
let forcedBusy = false;
let forcedError = '';
let observedError = '';
let forcedResult: TelegramImportResult | null = null;
let forcedSpecial: 'not-set-up' | 'token-rejected' | null = null;
let observedResult: TelegramImportResult | null | undefined;
let observedSpecial: 'not-set-up' | 'token-rejected' | null | undefined;
let stringCursor = 0;
let nullCursor = 0;
let boolCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: ((initial: unknown): unknown => {
      if (typeof initial === 'string') {
        stringCursor += 1;
        if (stringCursor === 1) {
          return [forcedInput, (() => {}) as Dispatch<SetStateAction<string>>] as unknown;
        }
        // The error state is real so the run handler's `setError` lands in
        // React state; the wrapper observes it for the flow assertions.
        const [value, setValue] = actual.useState(forcedError);
        const observed = ((next: SetStateAction<string>) => {
          observedError =
            typeof next === 'function'
              ? (next as (previous: string) => string)(observedError)
              : next;
          (setValue as Dispatch<SetStateAction<string>>)(next as string);
        }) as unknown as Dispatch<SetStateAction<never>>;
        return [value, observed] as unknown;
      }
      if (typeof initial === 'boolean') {
        boolCursor += 1;
        return [forcedBusy, (() => {}) as Dispatch<SetStateAction<boolean>>] as unknown;
      }
      if (initial === null) {
        nullCursor += 1;
        if (nullCursor === 1) {
          return [
            forcedResult,
            ((next: SetStateAction<TelegramImportResult | null>) => {
              observedResult =
                typeof next === 'function'
                  ? (
                      next as (previous: TelegramImportResult | null) => TelegramImportResult | null
                    )(forcedResult)
                  : next;
            }) as Dispatch<SetStateAction<TelegramImportResult | null>>,
          ] as unknown;
        }
        return [
          forcedSpecial,
          ((next: SetStateAction<'not-set-up' | 'token-rejected' | null>) => {
            observedSpecial =
              typeof next === 'function'
                ? (
                    next as (
                      previous: 'not-set-up' | 'token-rejected' | null,
                    ) => 'not-set-up' | 'token-rejected' | null
                  )(forcedSpecial)
                : next;
          }) as Dispatch<SetStateAction<'not-set-up' | 'token-rejected' | null>>,
        ] as unknown;
      }
      return actual.useState(initial as never);
    }) as typeof actual.useState,
  };
});

function result(overrides?: Partial<TelegramImportResult>): TelegramImportResult {
  return {
    pack: {
      id: 'pack-imported',
      title: 'FunCats',
      stickers: [],
    },
    imported: 5,
    skippedAnimated: 2,
    skippedInvalid: 1,
    partial: false,
    ...overrides,
  };
}

const noopApi = {
  importTelegramStickers: async () => result(),
} as unknown as import('@/lib/stickers-api').StickersApi;

async function renderSheet(input?: {
  importFn?: (value: string) => Promise<TelegramImportResult>;
  onClose?: () => void;
  onDone?: () => void;
  onOpenPack?: (packId: string) => void;
}): Promise<string> {
  for (const key of Object.keys(pressed)) {
    delete pressed[key];
  }
  stringCursor = 0;
  nullCursor = 0;
  boolCursor = 0;
  observedError = forcedError;
  observedResult = undefined;
  observedSpecial = undefined;
  const module = await import('./telegram-import-sheet');
  return renderToStaticMarkup(
    createElement(module.TelegramImportSheet, {
      visible: true,
      onClose: input?.onClose ?? (() => {}),
      onDone: input?.onDone ?? (() => {}),
      onOpenPack: input?.onOpenPack ?? (() => {}),
      api: noopApi,
      ...(input?.importFn === undefined ? {} : { importFn: input.importFn }),
    }),
  );
}

function resetForced(): void {
  forcedInput = '';
  forcedBusy = false;
  forcedError = '';
  observedError = '';
  forcedResult = null;
  forcedSpecial = null;
  observedResult = undefined;
  observedSpecial = undefined;
}

function press(label: string): void {
  const handlers = pressed[label] ?? [];
  expect(handlers.length).toBeGreaterThan(0);
  for (const handler of handlers) {
    handler();
  }
}

describe('TelegramImportSheet', () => {
  it('renders the form with the intro, field and personal-use note', async () => {
    resetForced();
    const html = await renderSheet();
    expect(html).toContain('Import from Telegram');
    expect(html).toContain('t.me/addstickers/NAME');
    expect(html).toContain('Pack link or name');
    expect(html).toContain('t.me/addstickers/FunCats');
    expect(html).toContain('Imported packs are for personal use.');
    expect(html).toContain('Cancel');
    expect(html).toContain('Import');
  });

  it('shows the empty-input sentence without calling the importer', async () => {
    resetForced();
    forcedInput = '';
    let called = 0;
    await renderSheet({
      importFn: async () => {
        called += 1;
        return result();
      },
    });
    press('Import');
    await flush();
    expect(called).toBe(0);
    expect(observedError).toBe('Paste a pack link or name first.');
  });

  it('calls the importer with the trimmed input on Import', async () => {
    resetForced();
    forcedInput = '  t.me/addstickers/FunCats \n';
    let received = '';
    await renderSheet({
      importFn: async (value: string) => {
        received = value;
        return result();
      },
    });
    press('Import');
    await flush();
    expect(received).toBe('t.me/addstickers/FunCats');
  });

  it('shows the success result with the counts and no Import again', async () => {
    resetForced();
    forcedResult = result();
    const html = await renderSheet();
    expect(html).toContain('Imported from Telegram: FunCats');
    expect(html).toContain('5 stickers added');
    expect(html).toContain('2 animated stickers were skipped');
    expect(html).toContain('1 file was skipped as invalid');
    expect(html).not.toContain('Import again');
    expect(html).toContain('Done');
    expect(html).toContain('Open pack');
    expect(html).toContain('This pack stays private.');
  });

  it('uses the singular count forms for one sticker', async () => {
    resetForced();
    forcedResult = result({ imported: 1, skippedAnimated: 1, skippedInvalid: 0 });
    const html = await renderSheet();
    expect(html).toContain('1 sticker added');
    expect(html).toContain('1 animated sticker was skipped');
    expect(html).not.toContain('files were skipped as invalid');
  });

  it('offers Import again on a partial result', async () => {
    resetForced();
    forcedInput = 'cats';
    forcedResult = result({ partial: true });
    let received = '';
    const html = await renderSheet({
      importFn: async (value: string) => {
        received = value;
        return result({ partial: false });
      },
    });
    expect(html).toContain('Import again');
    expect(html).toContain('The import ran out of time. Run it again to fill in the rest.');
    press('Import again');
    await flush();
    expect(received).toBe('cats');
  });

  it('surfaces a failed Import again as an error line on the result card', async () => {
    resetForced();
    forcedInput = 'cats';
    forcedResult = result({ partial: true });
    await renderSheet({
      importFn: async () => {
        throw new StickersApiError(429, 'rate_limited', 'slow down');
      },
    });
    press('Import again');
    await flush();
    expect(observedError).toBe('Too many imports. Try again in an hour.');

    resetForced();
    forcedResult = result({ partial: true });
    forcedError = 'Too many imports. Try again in an hour.';
    const html = await renderSheet();
    expect(html).toContain('Imported from Telegram: FunCats');
    expect(html).toContain('Too many imports. Try again in an hour.');
  });

  it('clears the result card when Import again hits a special state', async () => {
    resetForced();
    forcedInput = 'cats';
    forcedResult = result({ partial: true });
    await renderSheet({
      importFn: async () => {
        throw new StickersApiError(409, 'token_invalid', 'rejected');
      },
    });
    press('Import again');
    await flush();
    expect(observedResult).toBe(null);
    expect(observedSpecial).toBe('token-rejected');
  });

  it('shows the not-set-up state after import_unavailable', async () => {
    resetForced();
    forcedSpecial = 'not-set-up';
    const html = await renderSheet();
    expect(html).toContain('Telegram import is not set up');
    expect(html).toContain('The server owner can turn it on in Settings');
    expect(html).not.toContain('Pack link or name');
  });

  it('maps a rate-limit refusal to the rate-limit sentence', async () => {
    resetForced();
    forcedInput = 'cats';
    await renderSheet({
      importFn: async () => {
        throw new StickersApiError(429, 'rate_limited', 'slow down');
      },
    });
    press('Import');
    await flush();
    expect(observedError).toBe('Too many imports. Try again in an hour.');
  });

  it('maps the token rejection to the token-rejected state markup', async () => {
    resetForced();
    forcedSpecial = 'token-rejected';
    const html = await renderSheet();
    expect(html).toContain('The Telegram token was rejected');
    expect(html).toContain('The server owner needs to update it.');
  });

  it('blocks closing while busy and shows the busy line', async () => {
    resetForced();
    forcedBusy = true;
    const html = await renderSheet();
    expect(html).toContain('Importing…');
    expect(html).toContain('This can take up to 30 seconds.');

    // The ref guard is real (only `useState` is mocked): an in-flight import
    // blocks every close path even though the markup above is forced.
    resetForced();
    forcedInput = 'cats';
    let closed = 0;
    let calls = 0;
    await renderSheet({
      onClose: () => {
        closed += 1;
      },
      importFn: () => {
        calls += 1;
        return new Promise<TelegramImportResult>(() => {});
      },
    });
    press('Import');
    press('Import');
    press('Close');
    press('Dismiss import');
    press('Cancel');
    expect(calls).toBe(1);
    expect(closed).toBe(0);
  });

  it('closes on Close and on Cancel when idle', async () => {
    resetForced();
    let closed = 0;
    await renderSheet({
      onClose: () => {
        closed += 1;
      },
    });
    press('Close');
    press('Cancel');
    press('Dismiss import');
    expect(closed).toBe(3);
  });

  it('reloads on Done and opens the editor on Open pack', async () => {
    resetForced();
    forcedResult = result();
    let done = 0;
    let closed = 0;
    let opened = '';
    await renderSheet({
      onDone: () => {
        done += 1;
      },
      onClose: () => {
        closed += 1;
      },
      onOpenPack: (packId: string) => {
        opened = packId;
      },
    });
    press('Done');
    expect(done).toBe(1);
    expect(closed).toBe(1);
    press('Open pack');
    expect(opened).toBe('pack-imported');
    expect(done).toBe(2);
    expect(closed).toBe(2);
  });
});
