import { describe, expect, it } from 'vitest';

import {
  createVoicePlayback,
  isPlayableVoiceUrl,
  MIC_DENIED_MESSAGE,
  RECORD_FAILED_MESSAGE,
  voiceAudioSource,
  type VoiceSpeaker,
} from './voice-native';

function speaker(id: string): VoiceSpeaker & { paused: boolean } {
  const state: VoiceSpeaker & { paused: boolean } = {
    messageId: id,
    playing: true,
    positionMs: 0,
    durationMs: 5000,
    speed: 1,
    paused: false,
    play: () => {},
    pause: () => {
      state.paused = true;
    },
    seekTo: async () => {},
    cycleSpeed: () => {},
    release: () => {},
  };
  return state;
}

describe('voice playback registry + gates (T-0154)', () => {
  it('plays one voice at a time: claiming a second pauses the first', () => {
    const playback = createVoicePlayback();
    const first = speaker('m-1');
    const second = speaker('m-2');
    playback.claim(first);
    playback.claim(second);
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
    expect(playback.current()?.messageId).toBe('m-2');
  });

  it('resigning the current speaker clears it; resigning another keeps it', () => {
    const playback = createVoicePlayback();
    const first = speaker('m-1');
    const second = speaker('m-2');
    playback.claim(first);
    playback.resign(second);
    expect(playback.current()?.messageId).toBe('m-1');
    playback.resign(first);
    expect(playback.current()).toBeUndefined();
  });

  it('resigns by message id, so the host needs no claimed object', () => {
    const playback = createVoicePlayback();
    playback.claim(speaker('m-1'));
    // A different object for the same message still clears it (finding 1).
    playback.resign(speaker('m-1'));
    expect(playback.current()).toBeUndefined();
  });

  it('stopAll pauses the current speaker (leaving the chat stops playback)', () => {
    const playback = createVoicePlayback();
    const first = speaker('m-1');
    playback.claim(first);
    playback.stopAll();
    expect(first.paused).toBe(true);
    expect(playback.current()).toBeUndefined();
  });

  it('only a trusted http(s) voice URL is playable', () => {
    const hosts = new Set(['upload.zilar.test']);
    expect(isPlayableVoiceUrl('https://upload.zilar.test/get/voice.m4a', hosts)).toBe(true);
    expect(isPlayableVoiceUrl('https://evil.test/voice.m4a', hosts)).toBe(false);
    expect(isPlayableVoiceUrl('javascript:alert(1)', hosts)).toBe(false);
    expect(isPlayableVoiceUrl('data:audio/wav;base64,AAA', hosts)).toBe(false);
    expect(isPlayableVoiceUrl('not a url', hosts)).toBe(false);
  });

  it('an untrusted voice has no audio source: the bubble shows metadata only', async () => {
    const source = await voiceAudioSource({
      voice: {
        duration_ms: 5000,
        mime: 'audio/mp4',
        waveform: [10],
        url: 'https://evil.test/voice.m4a',
      },
      trustedHosts: new Set(['upload.zilar.test']),
    });
    expect(source).toBeUndefined();
  });

  it('a local recording plays from its file URI with no headers', async () => {
    const source = await voiceAudioSource({
      voice: { duration_ms: 5000, mime: 'audio/mp4', waveform: [10] },
      localUri: 'file:///cache/rec.m4a',
      trustedHosts: new Set(),
    });
    expect(source).toEqual({ uri: 'file:///cache/rec.m4a' });
  });

  it('the bearer rides only to the API origin, never to the upload host', async () => {
    const api = 'http://127.0.0.1:3188';
    const trusted = new Set(['127.0.0.1', 'upload.zilar.test']);
    const toUpload = await voiceAudioSource({
      voice: {
        duration_ms: 5000,
        mime: 'audio/mp4',
        waveform: [10],
        url: 'https://upload.zilar.test/get/voice.m4a',
      },
      trustedHosts: trusted,
      apiUrl: api,
      getToken: async () => 'tok',
    });
    expect(toUpload).toEqual({ uri: 'https://upload.zilar.test/get/voice.m4a' });

    const toApi = await voiceAudioSource({
      voice: {
        duration_ms: 5000,
        mime: 'audio/mp4',
        waveform: [10],
        url: `${api}/api/voice/cache/voice.m4a`,
      },
      trustedHosts: trusted,
      apiUrl: api,
      getToken: async () => 'tok',
    });
    expect(toApi).toEqual({
      uri: `${api}/api/voice/cache/voice.m4a`,
      headers: { authorization: 'Bearer tok' },
    });
  });

  it('exposes the plain permission-denied copy the composer shows', () => {
    expect(MIC_DENIED_MESSAGE).toContain('microphone');
    expect(RECORD_FAILED_MESSAGE.length).toBeGreaterThan(0);
  });
});
