/**
 * The screen-owned voice player (T-0154, review round 1): a single
 * `expo-audio` player that every voice bubble shares. The chat screen
 * creates it with `useVoicePlayerHost` and hands `controls` to each
 * `VoiceMessage`; unmounting (leaving the chat) stops playback and releases
 * the native player.
 *
 * One player at a time works like this: `play(B)` on the shared player
 * replaces the source (which stops A's audio natively) and notifies only
 * B's listener, so B shows playing; A's bubble is told to show paused
 * through its own listener — the shared player is never paused as a side
 * effect of switching. The registry (`createVoicePlayback`) is the UI-side
 * record of who is current; the host drives it from the real player events.
 *
 * The player is created lazily with `createAudioPlayer` (not the hook) so
 * the host lives outside any one bubble's lifecycle: a bubble unmounting
 * mid-play must not release the player another bubble is using.
 *
 * Split into `voice-player-registry.ts` and `voice-player-host.ts` (T-1032);
 * this barrel keeps the original path and exports every name unchanged.
 */

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
