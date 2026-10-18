// A mention's `@` must sit at the start of the body or right after whitespace
// or an opening bracket/quote, so `a@deepseek.com` is an address, not a
// mention.
const AT_PREFIX = `(?:^|[\\s(\\[{"'])`;

// The name must end the body or be followed by whitespace or punctuation, so
// `@Deepseeker` does not match `Deepseek`.
const AT_SUFFIX = `(?:$|[\\s,.:;!?)\\]}'"])`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `body` addresses an AI called by one of `names`, case-insensitively.
 * A name matches as `@<name>` (with a boundary on each side), or at the start
 * of the body followed by `,` or `:` as in "Deepseek, run the tests". Blank
 * names are ignored.
 */
export function bodyAddressesAi(body: string, names: readonly string[]): boolean {
  for (const name of names) {
    if (name.trim() === '') {
      continue;
    }
    const escaped = escapeRegExp(name);
    if (new RegExp(`${AT_PREFIX}@${escaped}${AT_SUFFIX}`, 'i').test(body)) {
      return true;
    }
    if (new RegExp(`^\\s*${escaped}[,:]`, 'i').test(body)) {
      return true;
    }
  }
  return false;
}
