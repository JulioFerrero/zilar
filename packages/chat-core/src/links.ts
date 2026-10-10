export type LinkSegment =
  { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<]+/gi;

const ALWAYS_STRIP = new Set(['.', ',', ';', ':', '!', '?', '…', '»', '"', "'"]);
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function countCharacter(value: string, character: string): number {
  let total = 0;
  for (const item of value) {
    if (item === character) {
      total += 1;
    }
  }
  return total;
}

/**
 * Removes trailing punctuation that belongs to the sentence rather than the
 * URL (`https://x.com/a).` becomes `https://x.com/a`). A closing bracket is
 * kept when the URL itself opened it.
 */
export function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === undefined) {
      break;
    }
    if (ALWAYS_STRIP.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = Object.entries(BRACKETS).find(([, closer]) => closer === last)?.[0];
    if (opener !== undefined && countCharacter(url, last) > countCharacter(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

/** Only `http` and `https` URLs with a non-empty authority become links. */
function toHref(url: string): string | undefined {
  const match = /^https?:\/\//i.exec(url);
  if (match === null) {
    return undefined;
  }
  const authority = url.slice(match[0].length).split(/[/?#]/, 1)[0] ?? '';
  return /[a-z0-9]/i.test(authority) ? url : undefined;
}

/**
 * Splits text into plain-text and link segments. Only `http://` and `https://`
 * URLs are linked; every other scheme (`javascript:`, `data:`, `vbscript:`,
 * `file:`) stays plain text, as does a bare `www.x.com`.
 */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index;
    const raw = match[0];
    if (index === undefined || raw === undefined) {
      continue;
    }
    const url = trimTrailingPunctuation(raw);
    const href = toHref(url);
    if (href === undefined) {
      continue;
    }
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    segments.push({ kind: 'link', text: url, href });
    const trailing = raw.slice(url.length);
    if (trailing.length > 0) {
      segments.push({ kind: 'text', text: trailing });
    }
    cursor = index + raw.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}
