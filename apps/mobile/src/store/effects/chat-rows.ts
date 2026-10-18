import type { ChatSummary } from '@zilar/chat-core';
import { summariesFor as coreSummariesFor } from '@zilar/client-core/store';
import type { ChatMessage } from '@zilar/xmpp-core';

import type { ChatEntry } from '../../lib/chat-api';

/**
 * Corrections, retractions and reactions arrive as their own stanzas and are never chat messages: the store applies them through `ingestEdit` / `ingestReaction` instead of adding a bubble.
 */
export function isUpdateStanza(message: ChatMessage): boolean {
  return (
    message.correction !== undefined ||
    message.retraction !== undefined ||
    message.reactions !== undefined
  );
}

/**
 * The shared core mapper keeps the server's `unread`, `lastMessage`, `readUntil` and `deliveredUntil` on the row.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  return coreSummariesFor(entry);
}
