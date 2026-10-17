import type { Contact } from '@zilar/api-contract';
import { jidLocal, normalizeJid } from '@zilar/protocol';

import type { ChatSummary } from './types';

/** A person to open, named by whatever the calling row already has. */
export type PersonTarget = {
  /** The bare JID from a message (`senderId`) or a contact. */
  jid?: string;
  /** The user id from a member row or a contact. */
  userId?: string;
  /** The `@handle` of a member row, for someone who is not a contact. */
  handle?: string | null | undefined;
};

/** The store slices `personTarget` needs; the component reads them itself. */
export type PersonLinkContext = {
  contacts: readonly Contact[];
  chats: readonly ChatSummary[];
  currentUserId: string;
};

export type PersonLinkRoute =
  | { pathname: '/chat/[id]'; params: { id: string } }
  | { pathname: '/u/[handle]'; params: { handle: string } };

/**
 * Where a tap on a person should go (T-1859; the phone twin of web T-1851):
 * myself and people with no chat and no handle have no route; a contact or an
 * existing chat (which covers my own AI) opens that DM; anyone else with a
 * handle opens their profile. The caller renders plain children for
 * `undefined`.
 */
export function personTarget(
  target: PersonTarget,
  ctx: PersonLinkContext,
): PersonLinkRoute | undefined {
  // A full JID is an occupant (`room@conference/nick`) from a sender the app
  // has not resolved yet; it names a room, never a person.
  const jid =
    target.jid === undefined || target.jid.includes('/') ? undefined : normalizeJid(target.jid);
  const userId = target.userId?.toLowerCase();
  const me = ctx.currentUserId.toLowerCase();
  if (userId === me || (jid !== undefined && jidLocal(jid) === me)) {
    return undefined;
  }
  const contact = ctx.contacts.find(
    (entry) =>
      (jid !== undefined && normalizeJid(entry.jid) === jid) ||
      (userId !== undefined && entry.userId.toLowerCase() === userId),
  );
  if (contact !== undefined) {
    return { pathname: '/chat/[id]', params: { id: contact.jid } };
  }
  if (jid !== undefined) {
    const chat = ctx.chats.find(
      (entry) => entry.kind !== 'group' && normalizeJid(entry.id) === jid,
    );
    if (chat !== undefined) {
      return { pathname: '/chat/[id]', params: { id: chat.id } };
    }
  }
  const handle = target.handle?.trim();
  if (handle !== undefined && handle !== '') {
    return { pathname: '/u/[handle]', params: { handle } };
  }
  return undefined;
}
