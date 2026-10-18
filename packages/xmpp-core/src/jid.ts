// Bare/full JID handling; only the resource accessor is XMPP-specific.
import { bareJid, jidDomain, jidLocal, normalizeJid } from '@zilar/protocol';

export { bareJid, jidDomain, normalizeJid };
export const jidLocalPart = jidLocal;

export function jidResource(value: string): string | undefined {
  const slash = value.indexOf('/');
  return slash === -1 ? undefined : value.slice(slash + 1);
}
