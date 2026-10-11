import type { ChatSummary } from '@zilar/chat-core';
import type { ChatMessage } from '@zilar/xmpp-core';

import type { ChatEntry } from '../../lib/chat-api';
import { summariesForTopicsEntry } from '../../lib/topics';

/**
 * XEP-0308 corrections, XEP-0424 retractions and XEP-0444 reactions arrive as
 * their own stanzas. They are never chat messages: an edit carries the new
 * full body, a retraction is empty, and a reaction-only update carries no body.
 * The store applies them through `ingestEdit` / `ingestReaction` instead of
 * adding them as their own bubble or preview row.
 */
export function isUpdateStanza(message: ChatMessage): boolean {
  return (
    message.correction !== undefined ||
    message.retraction !== undefined ||
    message.reactions !== undefined
  );
}

function summaryFor(entry: ChatEntry): ChatSummary {
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: entry.kind === 'dm' && entry.isAi === true,
    space: 'personal' as const,
    unread: 0,
    muted: false,
  };
  if (entry.kind === 'dm') {
    return {
      ...base,
      kind: 'dm',
      ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
      online: false,
    };
  }
  return {
    ...base,
    kind: 'group',
    memberCount: entry.memberCount,
    onlineCount: 0,
  };
}

/**
 * One `/api/chats` entry to its chat rows (T-0112): DMs map to one row; a
 * group with `topics` maps to one row per visible topic (General keeps the
 * group's old chat id); a group without the field keeps its single legacy
 * row. Malformed topic rows are dropped by `chatEntryTopics`, never rendered.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry)];
  }
  const rows = summariesForTopicsEntry(entry);
  // `summariesForTopicsEntry` already falls back to the legacy row for an
  // older server; `summariesFor` only keeps the export beside `summaryFor`.
  return rows;
}
