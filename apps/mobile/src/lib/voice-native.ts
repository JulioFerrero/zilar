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
