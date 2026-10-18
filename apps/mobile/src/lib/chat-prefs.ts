import {
  applyChatPrefs,
  isMuted,
  MUTE_DURATIONS,
  mutedUntilFor,
  sortPinnedFirst,
  type ChatSummary,
  type MuteDurationId,
} from '@zilar/chat-core';

/**
 * The shared rules live in @zilar/chat-core; this file re-exports them and keeps the phone-only archived filters.
 */

export { applyChatPrefs, MUTE_DURATIONS, mutedUntilFor, type MuteDurationId };
export { isMuted as isChatMuted, sortPinnedFirst as sortChatPinnedFirst };

export function archivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived === true);
}

export function unarchivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived !== true);
}
