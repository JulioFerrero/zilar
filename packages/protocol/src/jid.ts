// JID helpers shared by every package. A JID is `local@domain` or
// `local@domain/resource`; the localpart escapes `@` and `/`, so the first `@`
// and the first `/` are the separators.

/** The JID without its resource (`ana@zilar.test/web` becomes `ana@zilar.test`). */
export function bareJid(value: string): string {
  const slash = value.indexOf('/');
  return slash === -1 ? value : value.slice(0, slash);
}

/** The part before the `@` of the bare JID (the whole bare JID when it has no `@`). */
export function jidLocal(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(0, at);
}

/** The part after the `@` of the bare JID (the whole bare JID when it has no `@`). */
export function jidDomain(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(at + 1);
}

/** The bare JID, lowercased: the form the server compares and stores. */
export function normalizeJid(value: string): string {
  return bareJid(value).toLowerCase();
}

/**
 * Whether a JID belongs to one of our AIs. AIs are provisioned with an `ai-`
 * localpart (`ai-<aiId>@<domain>`), so the localpart alone decides it; any
 * resource (`/nick`) or query (`?x`) is dropped first.
 */
export function isAiJid(value: string): boolean {
  const withoutQuery = value.split('?')[0] ?? value;
  return jidLocal(withoutQuery).startsWith('ai-');
}
