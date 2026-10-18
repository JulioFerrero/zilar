import type { Contact } from '@zilar/api-contract';
import { resolvePerson } from '@zilar/chat-core';

import type { ChatSummary } from './types';

export type PersonTarget = {
  jid?: string;
  userId?: string;
  handle?: string | null | undefined;
};

export type PersonLinkContext = {
  contacts: readonly Contact[];
  chats: readonly ChatSummary[];
  currentUserId: string;
};

export type PersonLinkRoute =
  | { pathname: '/chat/[id]'; params: { id: string } }
  | { pathname: '/u/[handle]'; params: { handle: string } };

/**
 * The shared `resolvePerson` rule mapped to the two person routes; the caller renders plain children for `undefined`.
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
