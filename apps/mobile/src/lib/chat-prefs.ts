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
 * Chat preference helpers (T-0135). The shared rules (mute durations,
 * merging server rows into chat summaries, pinned-first ordering, the
 * group-mute-inherits-to-topics rule) live in @zilar/chat-core since
 * T-0876; this file re-exports them under the phone's names and keeps the
 * phone-only optimistic row and archived filters.
 */

export { applyChatPrefs, MUTE_DURATIONS, mutedUntilFor, type MuteDurationId };
export { isMuted as isChatMuted, sortPinnedFirst as sortChatPinnedFirst };

/**
 * Builds the optimistic row for a partial pref write (T-0135): the partial
 * input merged over the chat's existing saved row, so kept fields
 * (muted/archived/pinned of the same chat) never flash off during the PUT
 * flight. A pin stamps now; clearing a pin, unmuting or unarchiving writes
 * the default back, exactly like the server merge.
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
    updatedAt: now.toISOString(),
  };
}

/** The chats hidden from the main list (the Archived entry shows these). */
export function archivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived === true);
}

/** Chats of the main list: archived rows stay out until unarchived. */
export function unarchivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived !== true);
}
