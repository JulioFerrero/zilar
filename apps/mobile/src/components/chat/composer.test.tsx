// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickResult, PickedFile } from '@/lib/attachment-ports';
import type { GifItem } from '@/lib/gifs';
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import { Composer } from './composer';
import { waitForAct as waitFor } from '@/test/wait';

// The mobile app has no React Native testing library. The primitives are
// mocked with small DOM components and the two sheets are replaced by stubs
// that capture the props the composer hands them, so a test can call the same
// callbacks a tap would (the `use-action.test.tsx` jsdom pattern).
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Press = { onPress?: () => void };
type Kids = { children?: ReactNode };

const mocks = vi.hoisted(() => ({
  loadStickerPacks: vi.fn(),
  persistRecent: vi.fn(),
  readStoredRecents: vi.fn(),
  readStoredEmojiRecents: vi.fn(),
  persistEmojiRecent: vi.fn(),
  probeGifsAvailability: vi.fn(),
  state: {
    editTarget: undefined as undefined | { chatId: string; messageId: string },
    cancelEdit: vi.fn(),
    editMessage: vi.fn(),
  },
}));

type SheetProps = {
  open: boolean;
  tab: string | undefined;
  gifsVisible: boolean;
  emojiRecents: string[];
  packs: StickerPack[] | undefined;
  panelState: 'loading' | 'ready' | 'error' | 'empty';
  stickerRecents: RecentStickerEntry[];
  activePackId: string | undefined;
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (sticker: StickerChoice) => void;
  onRetryStickers: () => void;
  onPickGif: (gif: GifItem) => void;
  onClose: () => void;
};

type AttachProps = {
  open: boolean;
  busy: boolean;
  error: string | undefined;
  preview: { uri: string; name: string | undefined; size: number | undefined } | undefined;
  onPick: (choice: 'library' | 'camera' | 'file') => void;
  onClose: () => void;
};

const captured: { sheet?: SheetProps; attach?: AttachProps } = {};

vi.mock('react-native', () => ({
  Keyboard: { dismiss: () => {} },
  Pressable: ({
    onPress,
    accessibilityLabel,
    disabled,
    children,
  }: Press & { accessibilityLabel?: string; disabled?: boolean } & Kids) =>
    createElement(
      'button',
      { type: 'button', 'aria-label': accessibilityLabel, disabled, onClick: onPress },
      children,
    ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    placeholder,
  }: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel?: string;
    placeholder?: string;
  }) =>
    createElement('input', {
      value,
      placeholder,
      'aria-label': accessibilityLabel,
      onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
    }),
  View: ({ children }: Kids) => createElement('div', null, children),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('lucide-react-native', () => ({
  ArrowUp: () => null,
  Paperclip: () => null,
  Smile: () => null,
  X: () => null,
}));

vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: Kids) => createElement('span', null, children),
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: ({ label, onPress, children }: Press & Kids & { label: string }) =>
    createElement('button', { type: 'button', 'aria-label': label, onClick: onPress }, children),
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/lib/depth', () => ({
  ACCENT_FOREGROUND: '#000',
  KEY_PRIMARY_PRESSED_SHADOW: {},
  pressStyle: () => ({}),
  primaryKey: {},
  well: {},
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({
      editTarget: mocks.state.editTarget,
      cancelEdit: mocks.state.cancelEdit,
      editMessage: mocks.state.editMessage,
      messages: () => [],
    }),
}));

vi.mock('@/components/chat/edit-bar', () => ({ EditBar: () => null }));
vi.mock('@/components/chat/mention-picker', () => ({ MentionPicker: () => null }));
vi.mock('@/components/chat/voice-recorder', () => ({ VoiceRecorderButton: () => null }));

vi.mock('@/components/chat/emoji-sheet', () => ({
  EmojiSheet: (props: SheetProps) => {
    captured.sheet = props;
    return null;
  },
}));

vi.mock('@/components/chat/attach-sheet', () => ({
  AttachSheet: (props: AttachProps) => {
    captured.attach = props;
    return null;
  },
}));

vi.mock('@/components/chat/sticker-panel', () => ({
  loadStickerPacks: mocks.loadStickerPacks,
  persistRecent: mocks.persistRecent,
}));

vi.mock('@/components/chat/gif-panel', () => ({
  probeGifsAvailability: mocks.probeGifsAvailability,
}));

vi.mock('@/lib/stickers-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stickers-storage')>();
  return { ...actual, readStoredRecents: mocks.readStoredRecents };
});

vi.mock('@/lib/emoji-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/emoji-data')>();
  return {
    ...actual,
    readStoredEmojiRecents: mocks.readStoredEmojiRecents,
    persistEmojiRecent: mocks.persistEmojiRecent,
  };
});

vi.mock('@/lib/attachment-native', () => ({
  createAttachmentPicker: () => ({}),
  createGifDownloader: () => ({}),
}));

vi.mock('@/mock/gifs', () => ({ mockDemoGifs: () => [] }));

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  captured.sheet = undefined;
  captured.attach = undefined;
  mocks.state.editTarget = undefined;
  mocks.loadStickerPacks.mockReset();
  mocks.persistRecent.mockReset();
  mocks.readStoredRecents.mockReset().mockResolvedValue([]);
  mocks.readStoredEmojiRecents.mockReset().mockResolvedValue([]);
  mocks.persistEmojiRecent.mockReset().mockResolvedValue([]);
  mocks.probeGifsAvailability.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  // Let any pending load or persist settle inside act before unmounting.
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

const FILE: PickedFile = { uri: 'file:///cache/cat.jpg', name: 'cat.jpg', mimeType: 'image/jpeg' };
const GIF: GifItem = {
  id: 'g1',
  title: 'cat',
  url: '/api/gifs/g1',
  kind: 'image',
  width: 10,
  height: 10,
};
const STICKER: StickerChoice = {
  stickerId: '6f1f2a10-5c1f-4d57-9d0a-0d3f7a1b2c3d',
  packId: '0a9c8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  url: '/api/stickers/6f1f2a10-5c1f-4d57-9d0a-0d3f7a1b2c3d/file',
  width: 128,
  height: 128,
  mime: 'image/webp',
};
const PACK: StickerPack = {
  id: 'p1',
  title: 'Pack',
  stickers: [],
};

type Spies = {
  onSend: ReturnType<typeof vi.fn>;
  onSendSticker: ReturnType<typeof vi.fn>;
  onSendAttachment: ReturnType<typeof vi.fn>;
  onCancelReply: ReturnType<typeof vi.fn>;
};

type Extra = {
  picker?: { pickImageOrVideo: () => Promise<PickResult> };
  gifDownloader?: { download: (gif: GifItem) => Promise<unknown> };
  demoPacks?: StickerPack[];
  title?: string;
};

function render(extra: Extra = {}) {
  const spies: Spies = {
    onSend: vi.fn(),
    onSendSticker: vi.fn(),
    onSendAttachment: vi.fn(),
    onCancelReply: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(Composer, {
        ...spies,
        ...extra,
      } as never),
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, spies };
}

function sheet(): SheetProps {
  if (captured.sheet === undefined) {
    throw new Error('The emoji sheet has not rendered');
  }
  return captured.sheet;
}

function attach(): AttachProps {
  if (captured.attach === undefined) {
    throw new Error('The attach sheet has not rendered');
  }
  return captured.attach;
}

function byLabel(container: Element, label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function press(container: Element, label: string): void {
  const element = byLabel(container, label);
  if (element === null) {
    throw new Error(`No element labelled ${label}`);
  }
  act(() => element.click());
}

function type(container: Element, value: string): void {
  const input = byLabel(container, 'Message') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Composer text', () => {
  it('shows the placeholder with the title and no send button until there is text', () => {
    const { container } = render({ title: 'Ana' });
    expect((byLabel(container, 'Message') as HTMLInputElement).placeholder).toBe('Message Ana');
    expect(byLabel(container, 'Send message')).toBeNull();
    type(container, 'hi');
    expect(byLabel(container, 'Send message')).not.toBeNull();
  });

  it('sends the typed text and clears the field', () => {
    const { container, spies } = render();
    type(container, 'hello');
    press(container, 'Send message');
    expect(spies.onSend).toHaveBeenCalledWith('hello', undefined);
    expect((byLabel(container, 'Message') as HTMLInputElement).value).toBe('');
  });
});

describe('Composer emoji sheet', () => {
  it('opens the sheet and loads the sticker packs, recents and emoji recents', async () => {
    mocks.loadStickerPacks.mockResolvedValue([PACK]);
    mocks.readStoredRecents.mockResolvedValue([{ ...STICKER }]);
    mocks.readStoredEmojiRecents.mockResolvedValue(['e-grin']);
    const { container } = render();
    expect(sheet().open).toBe(false);
    press(container, 'Emoji');
    expect(sheet().open).toBe(true);
    expect(sheet().panelState).toBe('loading');
    await waitFor(() => {
      expect(sheet().panelState).toBe('ready');
      expect(sheet().packs).toEqual([PACK]);
      expect(sheet().stickerRecents).toHaveLength(1);
      expect(sheet().emojiRecents).toEqual(['e-grin']);
    });
    expect(mocks.probeGifsAvailability).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state for no packs and the error state when the load fails', async () => {
    mocks.loadStickerPacks.mockResolvedValueOnce([]);
    const { container } = render();
    press(container, 'Emoji');
    await waitFor(() => expect(sheet().panelState).toBe('empty'));
    mocks.loadStickerPacks.mockRejectedValueOnce(new Error('offline'));
    act(() => sheet().onRetryStickers());
    await waitFor(() => expect(sheet().panelState).toBe('error'));
    mocks.loadStickerPacks.mockResolvedValueOnce([PACK]);
    act(() => sheet().onRetryStickers());
    await waitFor(() => expect(sheet().panelState).toBe('ready'));
  });

  it('serves the demo packs without calling the server', async () => {
    const { container } = render({ demoPacks: [PACK] });
    press(container, 'Emoji');
    expect(sheet().panelState).toBe('ready');
    expect(sheet().packs).toEqual([PACK]);
    await waitFor(() => expect(mocks.readStoredRecents).toHaveBeenCalled());
    expect(mocks.loadStickerPacks).not.toHaveBeenCalled();
  });

  it('keeps the sheet usable when the recents cannot be read', async () => {
    mocks.loadStickerPacks.mockResolvedValue([PACK]);
    mocks.readStoredRecents.mockRejectedValue(new Error('storage'));
    mocks.readStoredEmojiRecents.mockRejectedValue(new Error('storage'));
    const { container } = render();
    press(container, 'Emoji');
    await waitFor(() => expect(sheet().panelState).toBe('ready'));
    expect(sheet().stickerRecents).toEqual([]);
    expect(sheet().emojiRecents).toEqual([]);
  });

  it('inserts a picked emoji, keeps the sheet open and remembers it', async () => {
    mocks.loadStickerPacks.mockResolvedValue([]);
    mocks.persistEmojiRecent.mockResolvedValue(['e-smile']);
    const { container } = render();
    press(container, 'Emoji');
    act(() => sheet().onPickEmoji('e-smile'));
    expect((byLabel(container, 'Message') as HTMLInputElement).value).toBe('e-smile');
    expect(sheet().open).toBe(true);
    await waitFor(() => expect(sheet().emojiRecents).toEqual(['e-smile']));
    expect(mocks.persistEmojiRecent).toHaveBeenCalledTimes(1);
  });

  it('still inserts the emoji when remembering it fails', async () => {
    mocks.persistEmojiRecent.mockRejectedValue(new Error('storage'));
    const { container } = render();
    act(() => sheet().onPickEmoji('e-smile'));
    await waitFor(() => expect(mocks.persistEmojiRecent).toHaveBeenCalled());
    expect((byLabel(container, 'Message') as HTMLInputElement).value).toBe('e-smile');
  });
});

describe('Composer sticker pick', () => {
  it('sends the sticker, closes the sheet and remembers it in recents', async () => {
    mocks.loadStickerPacks.mockResolvedValue([]);
    mocks.persistRecent.mockResolvedValue([{ ...STICKER }]);
    const { container, spies } = render();
    press(container, 'Emoji');
    act(() => sheet().onPickSticker(STICKER));
    expect(spies.onSendSticker).toHaveBeenCalledWith(STICKER);
    expect(sheet().open).toBe(false);
    await waitFor(() => expect(sheet().stickerRecents).toHaveLength(1));
  });

  it('sends a drifted sticker without writing it to recents', () => {
    const { spies } = render();
    act(() => sheet().onPickSticker({ ...STICKER, stickerId: 'not-a-uuid' }));
    expect(spies.onSendSticker).toHaveBeenCalledTimes(1);
    expect(mocks.persistRecent).not.toHaveBeenCalled();
  });

  it('sends the sticker even when remembering it fails', async () => {
    mocks.persistRecent.mockRejectedValue(new Error('storage'));
    const { spies } = render();
    act(() => sheet().onPickSticker(STICKER));
    await waitFor(() => expect(mocks.persistRecent).toHaveBeenCalled());
    expect(spies.onSendSticker).toHaveBeenCalledTimes(1);
    expect(sheet().stickerRecents).toEqual([]);
  });
});

describe('Composer GIF pick', () => {
  it('downloads the GIF, sends it with the caption and clears the field', async () => {
    const download = vi.fn().mockResolvedValue({ status: 'downloaded', file: FILE });
    const { container, spies } = render({ gifDownloader: { download } });
    type(container, ' look ');
    act(() => sheet().onPickGif(GIF));
    expect(download).toHaveBeenCalledWith(GIF);
    expect(sheet().open).toBe(false);
    await waitFor(() => expect(spies.onSendAttachment).toHaveBeenCalledTimes(1));
    expect(spies.onSendAttachment).toHaveBeenCalledWith(FILE, { caption: 'look' });
    expect(spies.onCancelReply).toHaveBeenCalledTimes(1);
    expect((byLabel(container, 'Message') as HTMLInputElement).value).toBe('');
  });

  it('sends both GIFs when a second is picked while the first download is pending', async () => {
    const second: GifItem = { ...GIF, id: 'g2', url: '/api/gifs/g2' };
    const secondFile: PickedFile = { ...FILE, uri: 'file:///cache/dog.gif', name: 'dog.gif' };
    let finishFirst: (value: unknown) => void = () => {};
    const download = vi.fn((gif: GifItem) =>
      gif.id === 'g1'
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve({ status: 'downloaded', file: secondFile }),
    );
    const { spies } = render({ gifDownloader: { download } });
    act(() => sheet().onPickGif(GIF));
    act(() => sheet().onPickGif(second));
    expect(download).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(spies.onSendAttachment).toHaveBeenCalledTimes(1));
    expect(spies.onSendAttachment).toHaveBeenLastCalledWith(secondFile, {});
    await act(async () => finishFirst({ status: 'downloaded', file: FILE }));
    await waitFor(() => expect(spies.onSendAttachment).toHaveBeenCalledTimes(2));
    expect(spies.onSendAttachment).toHaveBeenLastCalledWith(FILE, {});
  });

  it('shows the downloader message when the GIF cannot be fetched', async () => {
    const download = vi.fn().mockResolvedValue({ status: 'error', message: 'That GIF is gone.' });
    const { container, spies } = render({ gifDownloader: { download } });
    act(() => sheet().onPickGif(GIF));
    await waitFor(() => expect(attach().error).toBe('That GIF is gone.'));
    expect(spies.onSendAttachment).not.toHaveBeenCalled();
    expect(byLabel(container, 'Dismiss error')).not.toBeNull();
  });

  it('shows a fixed sentence when the download throws', async () => {
    const download = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const { spies } = render({ gifDownloader: { download } });
    act(() => sheet().onPickGif(GIF));
    await waitFor(() => expect(attach().error).toBe('Could not load that GIF. Try another.'));
    expect(spies.onSendAttachment).not.toHaveBeenCalled();
  });
});

describe('Composer attachments', () => {
  it('starts the picker straight from the tap and shows the picked file as the preview', async () => {
    const pickImageOrVideo = vi.fn().mockResolvedValue({ status: 'picked', file: FILE });
    const { container, spies } = render({ picker: { pickImageOrVideo } });
    press(container, 'Attach file');
    expect(attach().open).toBe(true);
    act(() => attach().onPick('library'));
    // The permission prompt is started inside the tap, not on a later tick.
    expect(pickImageOrVideo).toHaveBeenCalledTimes(1);
    expect(attach().busy).toBe(true);
    await waitFor(() => expect(attach().preview?.name).toBe('cat.jpg'));
    expect(attach().busy).toBe(false);
    expect(attach().error).toBeUndefined();
    press(container, 'Send message');
    expect(spies.onSendAttachment).toHaveBeenCalledWith(FILE, {});
    expect(attach().open).toBe(false);
    expect(attach().preview).toBeUndefined();
    expect(spies.onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('closes quietly when the pick is cancelled', async () => {
    const pickImageOrVideo = vi.fn().mockResolvedValue({ status: 'cancelled' });
    const { container } = render({ picker: { pickImageOrVideo } });
    press(container, 'Attach file');
    act(() => attach().onPick('library'));
    await waitFor(() => expect(attach().busy).toBe(false));
    expect(attach().preview).toBeUndefined();
    expect(attach().error).toBeUndefined();
  });

  it('shows the picker message when the pick is refused', async () => {
    const pickImageOrVideo = vi
      .fn()
      .mockResolvedValue({ status: 'error', message: 'Allow photo access in Settings.' });
    const { container } = render({ picker: { pickImageOrVideo } });
    press(container, 'Attach file');
    act(() => attach().onPick('library'));
    await waitFor(() => expect(attach().error).toBe('Allow photo access in Settings.'));
    expect(attach().busy).toBe(false);
    expect(attach().open).toBe(true);
  });

  it('shows a fixed sentence when the picker throws', async () => {
    const pickImageOrVideo = vi.fn().mockRejectedValue(new Error('native crash'));
    const { container } = render({ picker: { pickImageOrVideo } });
    press(container, 'Attach file');
    act(() => attach().onPick('library'));
    await waitFor(() => expect(attach().error).toBe('Could not pick that file. Try again.'));
    expect(attach().busy).toBe(false);
  });
});
