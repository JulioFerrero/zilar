// Bare/full JID handling for the XMPP stanzas. The shared helpers live in
// @zilar/protocol; only the resource accessor is XMPP-specific.
import { bareJid, jidDomain, jidLocal } from '@zilar/protocol';

export { bareJid, jidDomain };
export const jidLocalPart = jidLocal;

export function jidResource(value: string): string | undefined {
  const slash = value.indexOf('/');
  return slash === -1 ? undefined : value.slice(slash + 1);
}
