// A JID is `local@domain` or `local@domain/resource`; the localpart escapes `@` and `/`, so the first `@` and the first `/` are the separators.

export function bareJid(value: string): string {
  const slash = value.indexOf('/');
  return slash === -1 ? value : value.slice(0, slash);
}

export function jidLocal(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(0, at);
}

export function jidDomain(value: string): string {
  const bare = bareJid(value);
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(at + 1);
}

export function normalizeJid(value: string): string {
  return bareJid(value).toLowerCase();
}

// AIs are provisioned with an `ai-` localpart, so that alone decides it; any resource (`/nick`) or query (`?x`) is dropped first.
export function isAiJid(value: string): boolean {
  const withoutQuery = value.split('?')[0] ?? value;
  return jidLocal(withoutQuery).startsWith('ai-');
}
