import type { Contact } from '@/lib/chat-api';
import { contactChatId } from '@/lib/contacts-api';

// XMPP localparts are `[a-z0-9._-]`, at most 64 characters (the server's
// `SAFE_LOCALPART` in `apps/server/src/xmpp/provisioning.ts`). An id outside
// that set gets a hashed localpart on the server, so the lowercased id no
// longer names the DM.
const SAFE_LOCALPART = /^[a-z0-9._-]{1,64}$/;

/**
 * The DM chat id for a contact, resolved without guessing when possible
 * (MUX-16). The contacts list carries the peer's real JID; when the peer is
 * not in it, fall back to the id the server builds (`contactChatId`) only
 * when the user id is a safe XMPP localpart. An id that needs the server's
 * hash fallback resolves to `undefined`, so the caller shows a fixed error
 * instead of opening a chat that does not exist.
 */
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
