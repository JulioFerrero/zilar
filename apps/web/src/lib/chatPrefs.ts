import type { ChatPref } from '@/lib/api';
import type { ChatSummary } from '@galena/chat-core';

// T-0113: mute durations offered by the chat menu.
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

export function isMuted(pref: Pick<ChatPref, 'mutedUntil'> | undefined, now: number): boolean {
  if (pref?.mutedUntil === undefined || pref.mutedUntil === null) {
    return false;
  }
  const time = Date.parse(pref.mutedUntil);
  return !Number.isNaN(time) && time > now;
}

function prefDate(value: string | null): Date | undefined {
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
      if (pref !== undefined && isMuted(pref, now)) {
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
      return stripPref(chat);
    }
    // An inherited group mute only mutes: archive/pin stay per-row.
    const muted = isMuted(pref, now);
    if (inherited !== undefined) {
      return muted === chat.muted ? chat : { ...chat, muted };
    }
    const next: ChatSummary = {
      ...chat,
      muted,
      ...(pref.archived ? { archived: true } : {}),
    };
    const pinnedAt = prefDate(pref.pinnedAt);
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

function stripPref(chat: ChatSummary): ChatSummary {
  if (chat.muted === false && chat.archived === undefined && chat.pinnedAt === undefined) {
    return chat;
  }
  const next: ChatSummary = { ...chat, muted: false };
  delete next.archived;
  delete next.pinnedAt;
  return next;
}

/** Pinned chats/topics first (newer pins first), then the rest unchanged. */
export function sortPinnedFirst(chats: ChatSummary[]): ChatSummary[] {
  const pinned = chats
    .filter((chat) => chat.pinnedAt !== undefined)
    .sort((a, b) => {
      const time = (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0);
      return time !== 0 ? time : a.title.localeCompare(b.title);
    });
  if (pinned.length === 0) {
    return chats;
  }
  const pinnedIds = new Set(pinned.map((chat) => chat.id));
  return [...pinned, ...chats.filter((chat) => !pinnedIds.has(chat.id))];
}

/** Effective mute for a chat: its own row, else the group General row. */
export function effectivePrefFor(
  prefs: ReadonlyMap<string, ChatPref>,
  chatId: string,
  groupGeneralJid: string | undefined,
): ChatPref | undefined {
  const own = prefs.get(chatId.toLowerCase());
  if (own !== undefined) {
    return own;
  }
  if (groupGeneralJid !== undefined) {
    return prefs.get(groupGeneralJid.toLowerCase());
  }
  return undefined;
}
