import { bareJid } from '../jid';
import { openTagAttrs } from '../markup/scan';
import type { MarkedSnippet } from './match';
import type { ArchiveRow } from './service';

export const SEARCH_MIN_FUZZY_QUERY_CHARS = 3;

const START_SEL = '\u0001';
const STOP_SEL = '\u0002';

// `ts_headline` marks hits with the StartSel/StopSel sentinels. Split the
// headline into plain text plus character ranges, so the client highlights
// with spans and never renders HTML.
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

export function timestampToIso(value: ArchiveRow['timestamp']): string {
  const micros = typeof value === 'bigint' ? value : BigInt(value);
  return new Date(Number(micros / 1000n)).toISOString();
}

export function senderNameFor(
  row: ArchiveRow,
  ownBareJid: string,
  peerNames: Map<string, string>,
): string {
  if (row.kind === 'groupchat') {
    return row.nick === '' ? 'Unknown' : row.nick;
  }
  // In a DM archive the caller's own outgoing messages are stored under the
  // same `bare_peer` as incoming ones. The stanza's `from` decides: a `from`
  // naming the caller means the caller sent it.
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownBareJid) {
    return 'You';
  }
  return peerNames.get(row.barePeer) ?? 'Unknown';
}

// The stanza's `from` attribute, parsed defensively like the other tag
// readers: a missing or malformed attribute is null, never a throw.
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

// A correction row carries `<replace xmlns="urn:xmpp:message-correct:0"
// id="…"/>` naming the original origin_id.
export function correctionTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-correct:0')) {
    return null;
  }
  return tagAttribute(xml, 'replace');
}

// A retraction row carries `<retract xmlns="urn:xmpp:message-retract:1"
// id="…"/>` naming the retracted origin_id.
export function retractTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-retract:1')) {
    return null;
  }
  return tagAttribute(xml, 'retract');
}
