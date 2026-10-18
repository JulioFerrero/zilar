import type { Contact } from '@zilar/api-contract';
import { resolvePerson } from '@zilar/chat-core';

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
 * Where a tap on a person should go on the phone (T-1859): the shared
 * `resolvePerson` rule mapped to the two person routes. The caller renders
 * plain children for `undefined`.
 */
export function personTarget(
  target: PersonTarget,
  ctx: PersonLinkContext,
): PersonLinkRoute | undefined {
  const destination = resolvePerson(target, ctx);
  if (destination === undefined) {
    return undefined;
  }
  if (destination.kind === 'profile') {
    return { pathname: '/u/[handle]', params: { handle: destination.handle } };
  }
  return { pathname: '/chat/[id]', params: { id: destination.chatId } };
}
