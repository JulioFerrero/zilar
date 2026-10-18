// Live AI UI: the progress card an AI posts and edits is not a chat message. One rule,
// shared by push, the unread path, the memory indexer and the media extractor, so none
// drift. Edits carry the same payload, so both post and edit read as live AI UI.

import { decodePayload, isAiJid, type Payload } from '@zilar/protocol';
import { bareJid } from '../jid';
import { findCloseTag, nextOpenTag, openTagAttrs } from '../markup/scan';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/snippet';

// The agent payload namespace; the server cannot import it, so the value is repeated.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_NAMESPACE_ATTR = new RegExp(`\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["']`, 'i');

// Unescape in this order, so an escaped ampersand is not double-decoded.
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// Decoded defensively: a missing or malformed element is null, never a throw.
export function decodeAgentPayload(xml: string): Payload | null {
  let cursor = 0;
  while (true) {
    const open = nextOpenTag(xml, 'agent', cursor);
    if (open === null) {
      return null;
    }
    if (!AGENT_NAMESPACE_ATTR.test(open.attrs)) {
      cursor = open.end;
      continue;
    }
    const closeStart = findCloseTag(xml, 'agent', open.end);
    if (closeStart === null) {
      return null;
    }
    const result = decodePayload(unescapeXmlText(xml.slice(open.end, closeStart)));
    return result.ok ? result.payload : null;
  }
}

/** True when an archive row is the live AI UI itself. The sender comes from the archive,
 * never the free-text nick or the stanza's `from` in a room: ejabberd stores it in
 * `bare_peer`, and a member can pick any nick. */
export function isLiveAiUiRow(xml: string, barePeer: string): boolean {
  if (decodeAgentPayload(xml)?.type !== 'progress') {
    return false;
  }
  const sender = senderBareJid(xml, barePeer);
  return sender !== null && isAiJid(sender);
}

// A room row's sender is `bare_peer`; any other row's is the stanza's bare `from`.
function senderBareJid(xml: string, barePeer: string): string | null {
  const attrs = openTagAttrs(xml, 'message');
  const type = attrs?.match(/\btype\s*=\s*(["'])([^"']*)\1/)?.[2]?.trim();
  if (type === 'groupchat') {
    return barePeer.trim() === '' ? null : bareJid(barePeer);
  }
  const from = stanzaFrom(xml);
  return from === null ? null : bareJid(from);
}

export function cardEditTarget(xml: string): string | null {
  return correctionTarget(xml) ?? retractTarget(xml);
}

/** True when an edit targets a live-UI row, using the origin ids read in the same
 * batch. This catches an old server's payload-less edits. */
export function isLiveAiUiEdit(xml: string, liveIds: ReadonlySet<string>): boolean {
  const target = cardEditTarget(xml);
  return target !== null && liveIds.has(target);
}

export function liveAiUiIds(
  rows: readonly { originId: string; xml: string; barePeer: string }[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isLiveAiUiRow(row.xml, row.barePeer)) {
      ids.add(row.originId);
    }
  }
  return ids;
}
