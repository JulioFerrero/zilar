// T-0876: the chat-pref logic lives in @zilar/chat-core and is shared with
// mobile; this re-export keeps the web imports unchanged.
export {
  applyChatPrefs,
  effectivePrefFor,
  isMuted,
  MUTE_DURATIONS,
  mutedUntilFor,
  sortPinnedFirst,
  type MuteDurationId,
} from '@zilar/chat-core';
