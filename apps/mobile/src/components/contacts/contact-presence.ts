import { chatSubtitle } from '@zilar/chat-core';
import type { Contact } from '@/lib/contacts-api';
import type { ChatSummary } from '@/lib/types';

/**
 * Reads the same source the chat header reads: the chat store's DM rows, whose
 * `online` and `lastSeenAt` the XMPP presence handler writes. A contact whose DM
 * row carries no presence yet gets no status, so the row falls back to `@handle`.
 */

function dmChatFor(contact: Contact, chats: readonly ChatSummary[]): ChatSummary | undefined {
  return chats.find((row) => row.kind === 'dm' && !row.isAI && row.id === contact.jid);
}

export function contactOnline(contact: Contact, chats: readonly ChatSummary[]): boolean {
  return dmChatFor(contact, chats)?.online === true;
}

export function contactPresence(
  contact: Contact,
  chats: readonly ChatSummary[],
  now: Date,
): string | undefined {
  const chat = dmChatFor(contact, chats);
  if (chat === undefined || (chat.online !== true && chat.lastSeenAt === undefined)) {
    return undefined;
  }
  return chatSubtitle(chat, now);
}

/**
 * Contacts sorted the Telegram way: online first, then by name. The comparison is
 * case-insensitive so names do not split on capitalization.
 */
export function sortContactsByPresence(
  contacts: readonly Contact[],
  chats: readonly ChatSummary[],
): Contact[] {
  return [...contacts].sort((left, right) => {
    const online = Number(contactOnline(right, chats)) - Number(contactOnline(left, chats));
    if (online !== 0) {
      return online;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function filterContacts(contacts: readonly Contact[], query: string): Contact[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...contacts];
  }
  return contacts.filter((contact) => {
    const handle = contact.handle ?? '';
    return contact.name.toLowerCase().includes(needle) || handle.toLowerCase().includes(needle);
  });
}
