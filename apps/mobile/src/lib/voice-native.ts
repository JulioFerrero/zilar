/**
 * The native voice seams (T-0154). This module is now a barrel: the recorder
 * lives in `voice-recorder.ts`, playback in `voice-playback.ts`, and the
 * failure buckets and copy in `voice-failure.ts`. Split out by T-1030; every
 * name this module exported before is still re-exported here.
 */

export {
  MIC_DENIED_MESSAGE,
  MIC_FAILED_MESSAGE,
  RECORD_FAILED_MESSAGE,
  RECORD_TOO_LONG_MESSAGE,
  buildRecordingOptions,
  createVoiceRecorder,
} from './voice-recorder';
export type {
  FinishedRecording,
  NativeRecorderShape,
  RecordResult,
  RecordingAudio,
  VoiceRecorderPort,
} from './voice-recorder';

export {
  VOICE_SPEEDS,
  createVoicePlayback,
  isPlayableVoiceUrl,
  voiceAudioSource,
} from './voice-playback';
export type { VoicePlayback, VoiceSpeaker, VoiceSpeed } from './voice-playback';

export { voiceErrorCopy, voiceFailureReasonFor } from './voice-failure';
export type { VoiceFailureReason } from './voice-failure';
