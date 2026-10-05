import type { ChatSummary } from '@zilar/chat-core';

import type { ChatPref, PutChatPrefInput } from './chat-prefs-api';

/**
 * Chat preference helpers (T-0135), the mobile twin of the web
 * `lib/chatPrefs.ts`: mute durations, merging server rows into chat
 * summaries, pinned-first ordering, and the group-mute-inherits-to-topics
 * rule. Plain module with Vitest coverage; components stay thin.
 */

// T-0113: the mute durations offered by the chat action sheet.
export const MUTE_DURATIONS = [
  { id: 'hour', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: 'eight-hours', label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { id: 'day', label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'forever', label: 'Forever', ms: null },
] as const;

export type MuteDurationId = (typeof MUTE_DURATIONS)[number]['id'];

// A far-future stamp means "forever" (the server keeps it authoritative;
// 100 years out never expires in practice).
const FOREVER_MUTED_UNTIL = '2126-01-01T00:00:00.000Z';

export function mutedUntilFor(duration: MuteDurationId, now: Date): string {
  if (duration === 'forever') {
    return FOREVER_MUTED_UNTIL;
  }
  const entry = MUTE_DURATIONS.find((item) => item.id === duration);
  if (entry === undefined || entry.ms === null) {
    return FOREVER_MUTED_UNTIL;
  }
  return new Date(now.getTime() + entry.ms).toISOString();
}

export function isChatMuted(pref: Pick<ChatPref, 'mutedUntil'> | undefined, now: number): boolean {
  if (pref?.mutedUntil === undefined || pref.mutedUntil === null) {
    return false;
  }
  const time = Date.parse(pref.mutedUntil);
  return !Number.isNaN(time) && time > now;
}

function pinDate(value: string | null): Date | undefined {
  if (value === null) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Merges server pref rows into chat summaries. `muted` is true only while
 * `mutedUntil` is in the future; expired mutes read as unmuted (the row
 * itself is cleaned up on the next write). Muting a group mutes all its
 * topics: the pref sits on the General room JID and applies to every topic
 * of the group unless the topic has its own row.
 */
export function applyChatPrefs(
  chats: ChatSummary[],
  prefs: readonly ChatPref[],
  now: number,
): ChatSummary[] {
  const byJid = new Map(prefs.map((pref) => [pref.chatJid.toLowerCase(), pref]));
  const generalMutedByGroup = new Map<string, ChatPref>();
  for (const chat of chats) {
    if (chat.topic?.isGeneral === true && chat.groupId !== undefined) {
      const pref = byJid.get(chat.id.toLowerCase());
      if (pref !== undefined && isChatMuted(pref, now)) {
        generalMutedByGroup.set(chat.groupId, pref);
      }
    }
  }
  return chats.map((chat) => {
    const own = byJid.get(chat.id.toLowerCase());
    const inherited =
      own === undefined && chat.topic !== undefined && chat.groupId !== undefined
        ? generalMutedByGroup.get(chat.groupId)
        : undefined;
    const pref = own ?? inherited;
    if (pref === undefined) {
      return stripChatPref(chat);
    }
    // An inherited group mute only mutes: archive/pin stay per-row.
    if (inherited !== undefined) {
      return isChatMuted(pref, now) === chat.muted ? chat : { ...chat, muted: true };
    }
    const next: ChatSummary = {
      ...chat,
      muted: isChatMuted(pref, now),
      ...(pref.archived ? { archived: true } : {}),
    };
    const pinnedAt = pinDate(pref.pinnedAt);
    if (pinnedAt === undefined) {
      delete next.pinnedAt;
    } else {
      next.pinnedAt = pinnedAt;
    }
    if (!pref.archived) {
      delete next.archived;
    }
    return next;
  });
}

function stripChatPref(chat: ChatSummary): ChatSummary {
  if (chat.muted === false && chat.archived === undefined && chat.pinnedAt === undefined) {
    return chat;
  }
  const next: ChatSummary = { ...chat, muted: false };
  delete next.archived;
  delete next.pinnedAt;
  return next;
}

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

/** Pinned chats/topics first (newer pins first), then the rest unchanged. */
export function sortChatPinnedFirst(chats: ChatSummary[]): ChatSummary[] {
  const pinned = chats
    .filter((chat) => chat.pinnedAt !== undefined)
    .sort((left, right) => {
      const time = (right.pinnedAt?.getTime() ?? 0) - (left.pinnedAt?.getTime() ?? 0);
      return time !== 0 ? time : left.title.localeCompare(right.title);
    });
  if (pinned.length === 0) {
    return chats;
  }
  const pinnedIds = new Set(pinned.map((chat) => chat.id));
  return [...pinned, ...chats.filter((chat) => !pinnedIds.has(chat.id))];
}

/** The chats hidden from the main list (the Archived entry shows these). */
export function archivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived === true);
}

/** Chats of the main list: archived rows stay out until unarchived. */
export function unarchivedChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return chats.filter((chat) => chat.archived !== true);
}
