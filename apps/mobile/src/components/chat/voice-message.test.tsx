import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VoiceMessage } from './voice-message';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  Pause: 'Pause',
  Play: 'Play',
}));

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useReducedMotion: () => false,
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('@/store/chat-store-provider', () => ({
  useChatStore: () => new Set(['upload.zilar.test']),
}));

const VOICE = {
  duration_ms: 12_400,
  mime: 'audio/mp4',
  waveform: [26, 44, 62, 38, 20, 34, 58, 72],
};

const BASE_MESSAGE = {
  id: 'm-voice-1',
  chatId: 'ana',
  senderId: 'ana',
  senderName: 'Ana',
  createdAt: new Date('2026-09-28T10:00:00Z'),
  status: 'read' as const,
  voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
};

const CONTROLS = {
  play: () => {},
  pause: () => {},
  seekTo: () => Promise.resolve(),
  cycleSpeed: () => {},
};

describe('voice bubble (T-0154)', () => {
  it('renders the duration and the play state', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('0:12');
    expect(html).toContain('Play voice message');
  });

  it('shows Retry on a failed voice send', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: VOICE,
        outgoing: true,
        message: { ...BASE_MESSAGE, status: 'sending', failed: true },
        onRetryVoice: () => {},
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('Retry sending voice message');
  });

  it('renders one plain copy per failure reason', () => {
    const copies: Array<[string, string]> = [
      ['network', 'Could not send. Check your connection.'],
      ['too_large', 'That recording is too long to send.'],
      ['unsupported_file', 'That recording could not be read.'],
      ['upload_refused', 'Could not upload the recording.'],
      ['server_unavailable', 'Could not send the voice message. Try again.'],
      ['timed_out', 'Sending took too long. Try again.'],
    ];
    for (const [reason, copy] of copies) {
      const html = renderToStaticMarkup(
        createElement(VoiceMessage, {
          voice: VOICE,
          outgoing: true,
          message: {
            ...BASE_MESSAGE,
            status: 'sending',
            failed: true,
            failureReason: reason,
          } as never,
          onRetryVoice: () => {},
          controls: CONTROLS,
        }),
      );
      expect(html).toContain(copy);
    }
  });

  it('shows Cancel while the upload runs', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'file:///cache/rec.m4a' },
        outgoing: true,
        message: {
          ...BASE_MESSAGE,
          status: 'sending',
          voice: { ...VOICE, url: 'file:///cache/rec.m4a' },
          localUri: 'file:///cache/rec.m4a',
        } as never,
        onCancelVoice: () => {},
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('Cancel voice upload');
  });

  it('shows metadata only for an untrusted voice (no fetch)', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://evil.test/voice.m4a' },
        outgoing: false,
        message: {
          ...BASE_MESSAGE,
          voice: { ...VOICE, url: undefined },
        },
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('0:12');
  });

  it('shows the speed toggle', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('Playback speed 1x');
  });
});
