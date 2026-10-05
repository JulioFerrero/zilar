import { describe, expect, it } from 'vitest';

import { mockDemoVoice } from './voice';
import { VoiceMetaSchema } from '@zilar/protocol';

describe('mock demo voice (T-0154)', () => {
  it('passes VoiceMetaSchema so the mock bubble renders without a server', () => {
    const voice = mockDemoVoice();
    expect(VoiceMetaSchema.safeParse(voice).success).toBe(true);
    expect(voice.duration_ms).toBe(12_400);
    expect(voice.waveform.length).toBeGreaterThan(0);
  });
});
