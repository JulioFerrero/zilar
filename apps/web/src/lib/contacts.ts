import { localpartOf, type ChatSummary } from '@zilar/chat-core';
import type { Contact } from '@/lib/api';

/**
 * The contact behind a DM, matched by bare JID the way the mobile header does
 * (T-1192): a DM row's id is the peer's JID, and a contact whose id needs the
 * server's hash fallback still matches by its localpart. Returns undefined for
 * a group, a topic or an AI chat, and for a DM the contacts list does not know.
 */
export function dmContactFor(chat: ChatSummary, contacts: readonly Contact[]): Contact | undefined {
  if (chat.kind !== 'dm' || chat.isAI) {
    return undefined;
  }
  const local = localpartOf(chat.id);
  return contacts.find((entry) => entry.jid === chat.id || entry.userId.toLowerCase() === local);
}

/**
 * The `@handle` a DM's peer is shown under. The contacts list carries it
 * (T-0163: every user owns one), so that is the answer whenever the contact is
 * known. A payload without it (an older server, or the dev mock whose contacts
 * omit the optional field) falls back to the DM's JID localpart, which the
 * panel then confirms through `GET /api/users/by-handle/:handle`.
 */
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
