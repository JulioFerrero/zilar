import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VoiceMessage, resolvePlaySource } from './voice-message';
import { createWhistlePort, type WhistlePort } from '@/lib/whistle-port';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  AudioLines: 'AudioLines',
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

vi.mock('./voice-transcribe-confirm', () => ({
  VoiceTranscribeConfirm: 'VoiceTranscribeConfirm',
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

function fakeWhistle(available: boolean): WhistlePort {
  return createWhistlePort({ isAvailable: () => available });
}

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

  it('hides the transcript toggle when the voice has no transcript', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
      }),
    );
    expect(html).not.toContain('Show transcript');
    expect(html).not.toContain('Hide transcript');
  });

  it('shows the transcript toggle when the voice has a transcript', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: {
          ...VOICE,
          url: 'https://upload.zilar.test/get/voice.m4a',
          transcript: { text: 'hello', source: 'local' as const },
        },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
      }),
    );
    expect(html).toContain('Show transcript');
  });

  it('a stale source resolve is ignored: the last tap wins', async () => {
    const seen = { current: 0 };
    const played: string[] = [];
    const missing: string[] = [];
    // Two taps; the first resolve arrives last (out of order).
    seen.current += 1;
    const first = seen.current;
    seen.current += 1;
    const second = seen.current;
    await resolvePlaySource(
      {
        voice: { duration_ms: 5000, mime: 'audio/mp4', waveform: [1] },
        localUri: 'file:///cache/second.m4a',
        trustedHosts: new Set(),
      },
      seen,
      second,
      (source) => played.push(source.uri),
      () => missing.push('second'),
    );
    await resolvePlaySource(
      {
        voice: { duration_ms: 5000, mime: 'audio/mp4', waveform: [1] },
        localUri: 'file:///cache/first.m4a',
        trustedHosts: new Set(),
      },
      { current: first - 1 },
      first,
      (source) => played.push(source.uri),
      () => missing.push('first'),
    );
    expect(played).toEqual(['file:///cache/second.m4a']);
    expect(missing).toEqual([]);
  });

  it('a missing source reports the play error on the latest tap', async () => {
    const seen = { current: 1 };
    const played: string[] = [];
    const missing: string[] = [];
    await resolvePlaySource(
      {
        voice: { duration_ms: 5000, mime: 'audio/mp4', waveform: [1] },
        trustedHosts: new Set(),
      },
      seen,
      1,
      (source) => played.push(source.uri),
      () => missing.push('latest'),
    );
    expect(played).toEqual([]);
    expect(missing).toEqual(['latest']);
  });

  it('hides the Transcribe button when the engine is unavailable', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
        whistle: fakeWhistle(false),
      }),
    );
    expect(html).not.toContain('Transcribe voice message');
  });

  it('shows the Transcribe button when the engine is available', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
        whistle: fakeWhistle(true),
        transcripts: {},
      }),
    );
    expect(html).toContain('Transcribe voice message');
  });

  it('hides the Transcribe button when a transcript is stored', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://upload.zilar.test/get/voice.m4a' },
        outgoing: false,
        message: BASE_MESSAGE,
        controls: CONTROLS,
        whistle: fakeWhistle(true),
        transcripts: { 'm-voice-1': { text: 'hello there' } },
      }),
    );
    expect(html).not.toContain('Transcribe voice message');
    expect(html).toContain('Show transcript');
  });

  it('hides the Transcribe button when the voice is not playable', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceMessage, {
        voice: { ...VOICE, url: 'https://evil.test/voice.m4a' },
        outgoing: false,
        message: { ...BASE_MESSAGE, voice: { ...VOICE, url: undefined } },
        controls: CONTROLS,
        whistle: fakeWhistle(true),
        transcripts: {},
      }),
    );
    expect(html).not.toContain('Transcribe voice message');
  });
});
