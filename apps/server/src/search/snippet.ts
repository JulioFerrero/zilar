import { bareJid } from '../jid';
import { openTagAttrs } from '../markup/scan';
import type { MarkedSnippet } from './match';
import type { ArchiveRow } from './service';

export const SEARCH_MIN_FUZZY_QUERY_CHARS = 3;

const START_SEL = '\u0001';
const STOP_SEL = '\u0002';

// Splits the `ts_headline` sentinels into plain text plus ranges, so the client
// highlights with spans and never renders HTML.
export function headlineToSnippet(headline: string): MarkedSnippet {
  let snippet = '';
  const marks: Array<[number, number]> = [];
  let open: number | null = null;
  for (const char of headline) {
    if (char === START_SEL) {
      if (open === null) {
        open = [...snippet].length;
      }
      continue;
    }
    if (char === STOP_SEL) {
      if (open !== null) {
        const end = [...snippet].length;
        if (end > open) {
          marks.push([open, end]);
        }
        open = null;
      }
      continue;
    }
    snippet += char;
  }
  return { snippet, marks };
}

const WHITESPACE = /\s/;
const isSpace = (char: string | undefined): boolean => char !== undefined && WHITESPACE.test(char);
const BLOCKQUOTE = '>';
const LIST_MARKERS = ['-', '*', '+'];

// Strip common Markdown and remap the marks, so the highlight still lands on the
// hit in the plain-text snippet.
export function plainSnippet({ snippet, marks }: MarkedSnippet): MarkedSnippet {
  const chars = [...snippet];
  const keep = Array.from({ length: chars.length }, () => true);
  const drop = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      keep[i] = false;
    }
  };

  // Links keep only their text: `[text](url)` and `![text](url)`.
  let index = 0;
  while (index < chars.length) {
    const image = chars[index] === '!' && chars[index + 1] === '[';
    const open = image ? index + 1 : index;
    if (chars[open] !== '[') {
      index++;
      continue;
    }
    const close = chars.indexOf(']', open + 1);
    const paren = close === -1 || chars[close + 1] !== '(' ? -1 : chars.indexOf(')', close + 2);
    if (close === -1 || paren === -1) {
      index++;
      continue;
    }
    drop(index, open + 1);
    drop(close, paren + 1);
    index = paren + 1;
  }

  for (let i = 0; i < chars.length; i++) {
    if (!keep[i]) {
      continue;
    }
    const char = chars[i];
    if (char === undefined) {
      continue;
    }
    if ((i === 0 || chars[i - 1] === '\n') && char === '#') {
      let end = i;
      while (end < chars.length && keep[end] && chars[end] === '#') {
        end++;
      }
      if (end - i <= 6) {
        drop(i, end);
        while (end < chars.length && chars[end] === ' ') {
          drop(end, end + 1);
          end++;
        }
        i = end - 1;
        continue;
      }
    }
    if ((i === 0 || chars[i - 1] === '\n') && char === BLOCKQUOTE) {
      drop(i, i + 1);
      if (chars[i + 1] === ' ') {
        drop(i + 1, i + 2);
      }
      continue;
    }
    if ((i === 0 || chars[i - 1] === '\n') && LIST_MARKERS.includes(char) && chars[i + 1] === ' ') {
      drop(i, i + 1);
      continue;
    }
    if (char === '*' || char === '_' || char === '~') {
      if (chars[i + 1] === char) {
        drop(i, i + 2);
        i++;
      }
      continue;
    }
    if (char === '`') {
      drop(i, i + 1);
    }
  }

  // Record where every boundary lands in the stripped text, so a mark maps to the
  // same span of visible characters.
  const boundary = Array.from({ length: chars.length + 1 }, () => 0);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    if (!keep[i]) {
      boundary[i] = out.length;
      i++;
      continue;
    }
    const char = chars[i];
    if (char === undefined) {
      continue;
    }
    if (WHITESPACE.test(char)) {
      let end = i;
      while (end < chars.length && keep[end] && isSpace(chars[end])) {
        end++;
      }
      let next = end;
      while (next < chars.length && !keep[next]) {
        next++;
      }
      // A run at either end is trimmed; an internal run becomes one space.
      const internal = out !== '' && next < chars.length;
      for (let at = i; at < end; at++) {
        boundary[at] = out.length;
      }
      if (internal) {
        out += ' ';
      }
      i = end;
      continue;
    }
    boundary[i] = out.length;
    out += char;
    i++;
  }
  boundary[chars.length] = out.length;

  const remapped: Array<[number, number]> = [];
  for (const [start, end] of marks) {
    const from = boundary[Math.max(0, Math.min(start, chars.length))] ?? 0;
    const to = boundary[Math.max(0, Math.min(end, chars.length))] ?? 0;
    if (to > from) {
      remapped.push([from, to]);
    }
  }
  return { snippet: out, marks: remapped };
}

export function timestampToIso(value: ArchiveRow['timestamp']): string {
  const micros = typeof value === 'bigint' ? value : BigInt(value);
  return new Date(Number(micros / 1000n)).toISOString();
}

export function senderNameFor(
  row: ArchiveRow,
  ownBareJid: string,
  peerNames: Map<string, string>,
  roomNames: ReadonlyMap<string, string> = new Map(),
): string {
  // The real room sender is `bare_peer`, never the free-text nick; the nick is
  // only a fallback, then `Unknown`.
  if (row.kind === 'groupchat') {
    const sender = row.barePeer === '' ? null : bareJid(row.barePeer);
    const name = sender === null ? undefined : (roomNames.get(sender) ?? peerNames.get(sender));
    return name ?? (row.nick === '' ? 'Unknown' : row.nick);
  }
  // Outgoing DMs share `bare_peer` with incoming ones; the stanza's `from`
  // decides, so a `from` naming the caller means the caller sent it.
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownBareJid) {
    return 'You';
  }
  return peerNames.get(row.barePeer) ?? 'Unknown';
}

// A missing or malformed attribute is null, never a throw.
export function stanzaFrom(xml: string): string | null {
  const attrs = openTagAttrs(xml, 'message');
  const value = attrs?.match(/\bfrom\s*=\s*(["'])([\s\S]*?)\1/)?.[2]?.trim();
  return value === undefined || value === '' ? null : value;
}

export function chatJidFor(row: Pick<ArchiveRow, 'owner' | 'kind' | 'barePeer'>): string {
  return row.kind === 'groupchat' ? row.owner : row.barePeer;
}

function tagAttribute(xml: string, tag: string): string | null {
  const attrs = openTagAttrs(xml, tag);
  if (attrs === null) {
    return null;
  }
  return attrs.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
}

// `<replace xmlns="urn:xmpp:message-correct:0" id="…"/>` names the original id.
export function correctionTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-correct:0')) {
    return null;
  }
  return tagAttribute(xml, 'replace');
}

// `<retract xmlns="urn:xmpp:message-retract:1" id="…"/>` names the retracted id.
export function retractTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-retract:1')) {
    return null;
  }
  return tagAttribute(xml, 'retract');
}
