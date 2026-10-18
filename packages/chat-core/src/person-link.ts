import { jidLocal, normalizeJid } from '@zilar/protocol';

export type PersonLinkTarget = {
  jid?: string | undefined;
  userId?: string | undefined;
  handle?: string | null | undefined;
};

export type PersonLinkContact = {
  jid: string;
  userId: string;
};

export type PersonLinkChat = {
  id: string;
  kind: string;
};

export type PersonLinkContext = {
  contacts: readonly PersonLinkContact[];
  chats: readonly PersonLinkChat[];
  currentUserId: string;
  memberHandle?: (localpart: string) => string | undefined;
};

export type PersonDestination =
  | { kind: 'contact'; chatId: string }
  | { kind: 'chat'; chatId: string }
  | { kind: 'profile'; handle: string };

// A full JID is an occupant (`room@conference/nick`) and names a room, never a person, so it is dropped while the user id and handle it arrived with still count.
export function resolvePerson(
  target: PersonLinkTarget,
  ctx: PersonLinkContext,
): PersonDestination | undefined {
  const jid =
    target.jid === undefined || target.jid.includes('/') ? undefined : normalizeJid(target.jid);
  const userId = target.userId?.toLowerCase();
  const currentUserId = ctx.currentUserId.toLowerCase();
  if (userId === currentUserId || (jid !== undefined && jidLocal(jid) === currentUserId)) {
    return undefined;
  }

  const contact = ctx.contacts.find(
    (entry) =>
      (jid !== undefined && normalizeJid(entry.jid) === jid) ||
      (userId !== undefined && entry.userId.toLowerCase() === userId),
  );
  if (contact !== undefined) {
    return { kind: 'contact', chatId: contact.jid };
  }

  if (jid !== undefined) {
    const chat = ctx.chats.find(
      (entry) => entry.kind !== 'group' && normalizeJid(entry.id) === jid,
    );
    if (chat !== undefined) {
      return { kind: 'chat', chatId: chat.id };
    }
  }

  const handle = target.handle?.trim();
  if (handle !== undefined && handle !== '') {
    return { kind: 'profile', handle };
  }

  if (jid !== undefined && ctx.memberHandle !== undefined) {
    const fallback = ctx.memberHandle(jidLocal(jid));
    if (fallback !== undefined && fallback !== '') {
      return { kind: 'profile', handle: fallback };
    }
  }

  return undefined;
}
