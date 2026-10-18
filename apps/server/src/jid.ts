// JID comparison keys, bare and lowercased: a mixed-case stanza still matches.

export function bareJid(jid: string): string {
  const slash = jid.indexOf('/');
  return (slash < 0 ? jid : jid.slice(0, slash)).toLowerCase();
}

// The caller's own bare JID, which is the `from` a stanza carries. The localpart is
// authoritative (it scopes the archive query); the domain comes from config.
export function ownBareJid(allowed: { ownLocalpart: string }, domain: string): string {
  return `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
}
