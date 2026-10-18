import type { Contact } from '@/lib/chat-api';
import { contactChatId } from '@/lib/contacts-api';

// XMPP localparts are `[a-z0-9._-]`, at most 64 characters. An id outside that
// set gets a hashed localpart on the server, so it no longer names the DM.
const SAFE_LOCALPART = /^[a-z0-9._-]{1,64}$/;

/** Falls back to the server's `contactChatId` only for a safe localpart; an id
 *  that needs the hash fallback resolves to `undefined`. */
export function resolveDmChatId(
  userId: string,
  contacts: Contact[],
  domain: string,
): string | undefined {
  const contact = contacts.find((entry) => entry.userId === userId);
  if (contact !== undefined) {
    return contact.jid;
  }
  return SAFE_LOCALPART.test(userId.toLowerCase()) ? contactChatId(userId, domain) : undefined;
}
