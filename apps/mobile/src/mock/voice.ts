import type { VoiceMeta } from '@zilar/protocol';

/**
 * Demo voice clip for mock mode (T-0154): the Viernes chat (`mock/messages.ts`)
 * uses it, and the mock store sends through `sendVoice` without a server, so
 * the bubble renders identically everywhere. Mocked metadata only — never
 * fetched, never played from here.
 */
export function mockDemoVoice(): VoiceMeta {
  return {
    duration_ms: 12_400,
    mime: 'audio/mp4',
    waveform: [
      26, 44, 62, 38, 20, 34, 58, 72, 52, 30, 18, 40, 66, 80, 56, 32, 24, 48, 70, 60, 36, 22, 42,
      64, 50, 28, 38, 54,
    ],
    transcript: {
      text: "Plan is: terrace at nine, bring something to share. I'll get the ice.",
      language: 'en',
      source: 'local',
    },
  };
}
