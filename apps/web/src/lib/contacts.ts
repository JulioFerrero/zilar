import { localpartOf, type ChatSummary } from '@zilar/chat-core';
import type { Contact } from '@/lib/api';

/** A DM row's id is the peer's JID; a contact whose id needs the server's hash fallback
 * still matches by its localpart. Groups, topics and AI chats have none. */
export function dmContactFor(chat: ChatSummary, contacts: readonly Contact[]): Contact | undefined {
  if (chat.kind !== 'dm' || chat.isAI) {
    return undefined;
  }
  const local = localpartOf(chat.id);
  return contacts.find((entry) => entry.jid === chat.id || entry.userId.toLowerCase() === local);
}

/** The contacts list carries the handle; a payload without it (older server, dev mock)
 * falls back to the DM's JID localpart, which the panel then confirms via GET /api/users. */
export function dmHandleCandidate(
  chat: ChatSummary,
  contacts: readonly Contact[],
): string | undefined {
  const handle = dmContactFor(chat, contacts)?.handle;
  if (handle !== undefined && handle !== null && handle !== '') {
    return handle;
  }
  return localpartOf(chat.id);
}
