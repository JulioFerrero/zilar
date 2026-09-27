import { describe, expect, it } from 'vitest';
import { VoiceMetaSchema } from './index';

const voice = {
  duration_ms: 12400,
  mime: 'audio/mp4',
  waveform: [0, 64, 128, 255],
  transcript: { text: 'Quick update on the release.', language: 'en', source: 'api' },
};

describe('VoiceMetaSchema', () => {
  it('accepts voice metadata with a transcript', () => {
    const result = VoiceMetaSchema.safeParse(voice);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(voice);
    }
  });

  it('accepts voice metadata without a transcript', () => {
    expect(
      VoiceMetaSchema.safeParse({
        duration_ms: voice.duration_ms,
        mime: voice.mime,
        waveform: voice.waveform,
      }).success,
    ).toBe(true);
  });

  it('rejects a zero duration', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, duration_ms: 0 }).success).toBe(false);
  });

  it('rejects a duration longer than an hour', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, duration_ms: 3_600_001 }).success).toBe(false);
  });

  it('rejects a mime type that is not audio', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, mime: 'video/mp4' }).success).toBe(false);
  });

  it('rejects a mime type longer than 100 characters', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, mime: `audio/${'a'.repeat(95)}` }).success).toBe(
      false,
    );
  });

  it('rejects an empty waveform', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, waveform: [] }).success).toBe(false);
  });

  it('rejects a waveform longer than 128 samples', () => {
    const waveform = Array.from({ length: 129 }, () => 0);
    expect(VoiceMetaSchema.safeParse({ ...voice, waveform }).success).toBe(false);
  });

  it('rejects a waveform sample above 255', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, waveform: [0, 256] }).success).toBe(false);
  });

  it('rejects a waveform sample below 0', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, waveform: [0, -1] }).success).toBe(false);
  });

  it('rejects an unknown transcript source', () => {
    expect(
      VoiceMetaSchema.safeParse({
        ...voice,
        transcript: { text: 'hello', source: 'manual' },
      }).success,
    ).toBe(false);
  });

  it('rejects a transcript language shorter than 2 characters', () => {
    expect(
      VoiceMetaSchema.safeParse({
        ...voice,
        transcript: { text: 'hello', language: 'e', source: 'api' },
      }).success,
    ).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(VoiceMetaSchema.safeParse({ ...voice, extra: true }).success).toBe(false);
  });
});
