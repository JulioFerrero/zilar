import {
  applyChatPrefs,
  isMuted,
  MUTE_DURATIONS,
  mutedUntilFor,
  sortPinnedFirst,
  type ChatSummary,
  type MuteDurationId,
} from '@zilar/chat-core';

import type { ChatPref, PutChatPrefInput } from './chat-prefs-api';

/**
 * The shared rules live in @zilar/chat-core; this file re-exports them and keeps the phone-only optimistic row and archived filters.
 */

export { applyChatPrefs, MUTE_DURATIONS, mutedUntilFor, type MuteDurationId };
export { isMuted as isChatMuted, sortPinnedFirst as sortChatPinnedFirst };

/**
 * The partial input merged over the existing saved row, so kept fields never flash off during the PUT. A pin stamps now; clearing one writes the default back, as the server does.
 */
export function optimisticPrefRow(
  chatJid: string,
  saved: readonly ChatPref[],
  input: PutChatPrefInput,
  now: Date,
): ChatPref {
  const existing = saved.find((row) => row.chatJid.toLowerCase() === chatJid.toLowerCase());
  return {
    chatJid,
    mutedUntil: input.mutedUntil ?? existing?.mutedUntil ?? null,
    archived: input.archived ?? existing?.archived ?? false,
    pinnedAt:
      input.pinned === undefined
        ? (existing?.pinnedAt ?? null)
        : input.pinned
          ? now.toISOString()
          : null,
    // Keep the saved mark when the patch does not touch it, so it never flashes off.
    unreadMark: input.unreadMark ?? existing?.unreadMark ?? false,
    updatedAt: now.toISOString(),
  };
}

export function archivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived === true);
}

export function unarchivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived !== true);
}
