// The web voice helpers are split by concern under `voice/` (T-1034). Every
// importer keeps using `@/lib/voice`; this barrel re-exports the same names it
// always did.
export {
  VOICE_FILENAME,
  VOICE_MAX_BYTES,
  VOICE_MIN_MS,
  VOICE_MIME,
  WAVEFORM_BUCKETS,
  VoiceError,
  VoiceRecorder,
  isVoiceRecordingSupported,
  pickRecorderMime,
  voiceErrorFromGetUserMedia,
} from './voice/recorder';
export type { RecordedVoice } from './voice/recorder';

export {
  convertVoice,
  convertVoiceEffect,
  defaultVoicePort,
  uploadVoice,
  uploadVoiceEffect,
} from './voice/convert';
export type { ConvertedVoice, UploadSlotRequester, VoicePort } from './voice/convert';

export { computeWaveform, computeWaveformEffect } from './voice/waveform';

export { sampleVoiceDataUrl } from './voice/sample';
