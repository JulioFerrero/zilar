// The barrel for the screen-owned voice player: one `expo-audio` player shared by every voice bubble, created with `useVoicePlayerHost`; leaving the chat stops playback and releases it.

export {
  createVoicePlayerHostForTest,
  useVoicePlayerHost,
} from '@/components/chat/voice-player-host';
export type {
  HostPlayer,
  PlayerStatusTick,
  VoicePlayerControls,
  VoicePlayerHost,
} from '@/components/chat/voice-player-host';
export {
  emitPlayerStatusForTest,
  resetVoicePlayerForTest,
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
} from '@/components/chat/voice-player-registry';
