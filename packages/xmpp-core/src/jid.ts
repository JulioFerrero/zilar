// Small helpers for the bare/full JID handling the XMPP stanzas need. A JID is
// `local@domain` or `local@domain/resource`; the localpart escapes `@` and `/`,
// so the first `@` and the first `/` are the separators.
export function bareJid(value: string): string {
  const slash = value.indexOf('/');
  return slash === -1 ? value : value.slice(0, slash);
}

export function jidResource(value: string): string | undefined {
  const slash = value.indexOf('/');
  return slash === -1 ? undefined : value.slice(slash + 1);
}

export function jidDomain(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(at + 1);
}

export function jidLocalPart(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(0, at);
}
