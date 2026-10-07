import { describe, expect, it } from 'vitest';
import { decodeOrThrow, isValid, VoiceMetaSchema } from './index';

const voice = {
  duration_ms: 12400,
  mime: 'audio/mp4',
  waveform: [0, 64, 128, 255],
  transcript: { text: 'Quick update on the release.', language: 'en', source: 'api' },
};

describe('VoiceMetaSchema', () => {
  it('accepts voice metadata with a transcript', () => {
    expect(isValid(VoiceMetaSchema)(voice)).toBe(true);
    expect(decodeOrThrow(VoiceMetaSchema)(voice)).toEqual(voice);
  });

  it('accepts voice metadata without a transcript', () => {
    expect(
      isValid(VoiceMetaSchema)({
        duration_ms: voice.duration_ms,
        mime: voice.mime,
        waveform: voice.waveform,
      }),
    ).toBe(true);
  });

  it('accepts a download url', () => {
    const download = { ...voice, url: 'https://upload.zilar.localhost/upload/abc.m4a' };
    expect(isValid(VoiceMetaSchema)(download)).toBe(true);
    expect(decodeOrThrow(VoiceMetaSchema)(download).url).toBe(
      'https://upload.zilar.localhost/upload/abc.m4a',
    );
  });

  it('rejects a url that is not a url', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, url: 'not a url' })).toBe(false);
  });

  it('rejects a zero duration', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, duration_ms: 0 })).toBe(false);
  });

  it('rejects a duration longer than an hour', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, duration_ms: 3_600_001 })).toBe(false);
  });

  it('rejects a mime type that is not audio', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, mime: 'video/mp4' })).toBe(false);
  });

  it('rejects a mime type longer than 100 characters', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, mime: `audio/${'a'.repeat(95)}` })).toBe(false);
  });

  it('rejects an empty waveform', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, waveform: [] })).toBe(false);
  });

  it('rejects a waveform longer than 128 samples', () => {
    const waveform = Array.from({ length: 129 }, () => 0);
    expect(isValid(VoiceMetaSchema)({ ...voice, waveform })).toBe(false);
  });

  it('rejects a waveform sample above 255', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, waveform: [0, 256] })).toBe(false);
  });

  it('rejects a waveform sample below 0', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, waveform: [0, -1] })).toBe(false);
  });

  it('rejects an unknown transcript source', () => {
    expect(
      isValid(VoiceMetaSchema)({
        ...voice,
        transcript: { text: 'hello', source: 'manual' },
      }),
    ).toBe(false);
  });

  it('rejects a transcript language shorter than 2 characters', () => {
    expect(
      isValid(VoiceMetaSchema)({
        ...voice,
        transcript: { text: 'hello', language: 'e', source: 'api' },
      }),
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(isValid(VoiceMetaSchema)({ ...voice, extra: true })).toBe(false);
  });
});
