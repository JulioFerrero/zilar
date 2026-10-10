import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EmojiTab } from './emoji-tab';
import { VoiceMessage } from './voice-message';

// Device layout rules found on a real Android phone (2026-10-03), asserted on
// the rendered output of the component that owns each one. The host tags are
// the mocked primitive names, so `className` and `style` show in the markup.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  AudioLines: 'AudioLines',
  Clock: 'Clock',
  Hand: 'Hand',
  Hash: 'Hash',
  Heart: 'Heart',
  Lightbulb: 'Lightbulb',
  Pause: 'Pause',
  PawPrint: 'PawPrint',
  Pizza: 'Pizza',
  Plane: 'Plane',
  Play: 'Play',
  Smile: 'Smile',
  Trophy: 'Trophy',
}));

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useReducedMotion: () => false,
}));

vi.mock('./voice-transcribe-confirm', () => ({
  VoiceTranscribeConfirm: 'VoiceTranscribeConfirm',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => new Set(['upload.zilar.test']),
}));

/** The opening tag of the first host element whose markup contains `marker`. */
function openingTag(html: string, marker: string): string {
  const tag = html.match(new RegExp(`<[A-Za-z]+[^>]*${marker}[^>]*>`));
  if (tag === null) {
    throw new Error(`no element carries ${marker}`);
  }
  return tag[0];
}

describe('chat layout rules found on a real Android phone', () => {
  it('stretches the voice waveform to the end of the bubble', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: {
          duration_ms: 12_400,
          mime: 'audio/mp4',
          waveform: [26, 44, 62, 38, 20, 34, 58, 72],
          url: 'https://upload.zilar.test/get/voice.m4a',
        },
        outgoing: false,
        message: {
          id: 'm-voice-1',
          chatId: 'ana',
          senderId: 'ana',
          senderName: 'Ana',
          createdAt: new Date('2026-09-28T10:00:00Z'),
          status: 'read',
        },
        controls: {
          play: () => {},
          pause: () => {},
          seekTo: () => Promise.resolve(),
          cycleSpeed: () => {},
        },
      }),
    );
    // The play button and the waveform share the label; the waveform is the
    // one that spreads its bars across the row.
    const waveform = html.match(/<Pressable[^>]*Play voice message[^>]*justify-between[^>]*>/);
    expect(waveform).not.toBeNull();
    expect(waveform?.[0]).toContain('flex-1');
    expect(waveform?.[0]).not.toMatch(/style="[^"]*width/);
  });

  it('keeps the emoji category strip at its natural height (no empty gap under the tabs)', () => {
    // A horizontal ScrollView grows to fill the free height unless
    // `flexGrow: 0` is set (Android emulator, 2026-10-03).
    const html = renderToStaticMarkup(
      createElement(EmojiTab, {
        open: true,
        recents: [],
        activeCategory: undefined,
        onSelectCategory: () => {},
        onPick: () => {},
      }),
    );
    expect(openingTag(html, 'Emoji categories')).toContain('flex-grow:0');
  });
});
