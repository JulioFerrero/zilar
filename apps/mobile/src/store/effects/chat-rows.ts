import type { ChatSummary } from '@zilar/chat-core';
import { summariesFor as coreSummariesFor } from '@zilar/client-core/store';
import type { ChatMessage } from '@zilar/xmpp-core';

import type { ChatEntry } from '../../lib/chat-api';

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

/**
 * One `/api/chats` entry to its chat rows (T-0924): the shared core mapper
 * does the mapping for both apps, so a row carries the server `unread`,
 * `lastMessage`, `readUntil` and `deliveredUntil` the entry holds.
 *
 * T-1361: mobile used to keep its own DM branch that hardcoded `unread: 0` and
 * dropped the preview (groups already went through the core mapper), so a DM
 * unread that arrived while the app was killed or woken never reached its row.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  return coreSummariesFor(entry);
}
