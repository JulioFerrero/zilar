// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetGifsAvailability, setGifsAvailability } from '@/lib/gifs';
import { Composer } from './composer';

// Composer rules found on a real Android phone (2026-10-03), asserted on the
// mounted composer. The primitives are small DOM components; the sheets and
// the recorder are stubs that capture the props the composer hands them, so a
// test calls the same callbacks a tap or a recording would.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Press = { onPress?: () => void };
type Kids = { children?: ReactNode };

type InputProps = {
  onSelectionChange: (event: {
    nativeEvent: { selection: { start: number; end: number } };
  }) => void;
};

const captured: {
  input?: InputProps;
  gifsVisible?: boolean;
  onPickEmoji?: (emoji: string) => void;
  onRecordingChange?: (recording: boolean) => void;
} = {};

vi.mock('react-native', () => ({
  Keyboard: { dismiss: () => {} },
  Pressable: ({
    onPress,
    accessibilityLabel,
    children,
  }: Press & Kids & { accessibilityLabel?: string }) =>
    createElement(
      'button',
      { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress },
      children,
    ),
  TextInput: (props: {
    value: string;
    onChangeText: (value: string) => void;
    accessibilityLabel?: string;
    onSelectionChange: InputProps['onSelectionChange'];
  }) => {
    captured.input = props;
    return createElement('input', {
      value: props.value,
      'aria-label': props.accessibilityLabel,
      onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
    });
  },
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
      editTarget: undefined,
      cancelEdit: () => {},
      editMessage: () => {},
      messages: () => [],
    }),
}));

vi.mock('@/components/chat/edit-bar', () => ({ EditBar: () => null }));
vi.mock('@/components/chat/mention-picker', () => ({ MentionPicker: () => null }));
vi.mock('@/components/chat/attach-sheet', () => ({ AttachSheet: () => null }));
vi.mock('@/components/chat/voice-recorder', () => ({
  VoiceRecorderButton: (props: { onRecordingChange: (recording: boolean) => void }) => {
    captured.onRecordingChange = props.onRecordingChange;
    return null;
  },
}));

vi.mock('@/components/chat/emoji-sheet', () => ({
  EmojiSheet: (props: { gifsVisible: boolean; onPickEmoji: (emoji: string) => void }) => {
    captured.gifsVisible = props.gifsVisible;
    captured.onPickEmoji = props.onPickEmoji;
    return null;
  },
}));

vi.mock('@/components/chat/sticker-panel', () => ({
  loadStickerPacks: vi.fn(),
  persistRecent: vi.fn(),
}));

vi.mock('@/components/chat/gif-panel', () => ({
  probeGifsAvailability: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/stickers-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stickers-storage')>();
  return { ...actual, readStoredRecents: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/lib/emoji-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/emoji-data')>();
  return {
    ...actual,
    readStoredEmojiRecents: vi.fn().mockResolvedValue([]),
    persistEmojiRecent: vi.fn().mockResolvedValue([]),
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
  captured.input = undefined;
  captured.gifsVisible = undefined;
  captured.onPickEmoji = undefined;
  captured.onRecordingChange = undefined;
  resetGifsAvailability();
});

afterEach(async () => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  });
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
  resetGifsAvailability();
});

function render(): Element {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(Composer, {
        onSend: () => {},
        onSendSticker: () => {},
        onSendAttachment: () => {},
        onCancelReply: () => {},
      } as never),
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function byLabel(container: Element, label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function type(container: Element, value: string): void {
  const input = byLabel(container, 'Message') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('composer rules from the Android device pass', () => {
  it('hides the other controls while a voice note is being recorded', () => {
    // Attach, the text field and emoji share one row with the recorder: left
    // visible they push its Send button off the screen.
    const container = render();
    for (const label of ['Attach file', 'Message', 'Emoji']) {
      expect(byLabel(container, label)).not.toBeNull();
    }
    act(() => captured.onRecordingChange?.(true));
    for (const label of ['Attach file', 'Message', 'Emoji']) {
      expect(byLabel(container, label)).toBeNull();
    }
    act(() => captured.onRecordingChange?.(false));
    for (const label of ['Attach file', 'Message', 'Emoji']) {
      expect(byLabel(container, label)).not.toBeNull();
    }
  });

  it('offers the GIFs tab while availability is unknown or on, and hides it when the provider is off', () => {
    render();
    expect(captured.gifsVisible).toBe(true);
    mounted.pop()?.();
    setGifsAvailability(true);
    render();
    expect(captured.gifsVisible).toBe(true);
    mounted.pop()?.();
    setGifsAvailability(false);
    render();
    expect(captured.gifsVisible).toBe(false);
  });

  it('inserts a picked emoji at the tracked caret, not at the end', async () => {
    const container = render();
    type(container, 'ab');
    act(() =>
      captured.input?.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 1 } } }),
    );
    await act(async () => {
      captured.onPickEmoji?.('X');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    expect((byLabel(container, 'Message') as HTMLInputElement).value).toBe('aXb');
  });
});
