// Live AI UI (T-1400): the progress card an AI posts and edits while a turn
// runs is not a chat message. One rule, shared by push, the unread/preview
// path, the memory indexer and the media extractor, so none of them drift.
// The audit (docs/audit/agent-ux-plan.md §2.3) calls it "live AI UI"; today the
// only kind is an `<agent>` payload of type `progress`, sent by the gateway
// (agents/gateway/live.ts) and edited in place with corrections. T-1414: the
// edit carries the same payload, so both the post and its edits read as
// live AI UI; a correction without a payload (an old server) is still caught
// by its target id.

import { decodePayload, isAiJid, type Payload } from '@zilar/protocol';
import { bareJid } from '../jid';
import { findCloseTag, nextOpenTag, openTagAttrs } from '../markup/scan';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/snippet';

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_NAMESPACE_ATTR = new RegExp(`\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["']`, 'i');

// The parser unescapes the five XML entities (in this order, so an escaped
// ampersand is not double-decoded).
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// The `<agent>` payload of an archive row, decoded defensively like the other
// regex readers (search/routes.ts): a missing or malformed element is null,
// never a throw. This is the one decoder the media extractor and the memory
// indexer share.
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

/** True when an archive row is the live AI UI itself: an `<agent>` payload of
 * type `progress` sent by an AI. The sender comes from the archive, never from
 * the free-text nick or the stanza's `from` in a room: ejabberd stores the real
 * sender of a room row in `bare_peer`, and a member can pick any nick. A person
 * posting a `progress` payload is therefore not a card. */
export function isLiveAiUiRow(xml: string, barePeer: string): boolean {
  if (decodeAgentPayload(xml)?.type !== 'progress') {
    return false;
  }
  const sender = senderBareJid(xml, barePeer);
  return sender !== null && isAiJid(sender);
}

// A room row's sender is the archived `bare_peer`; any other row's sender is
// the stanza's bare `from`. Null when the row names neither.
function senderBareJid(xml: string, barePeer: string): string | null {
  const attrs = openTagAttrs(xml, 'message');
  const type = attrs?.match(/\btype\s*=\s*(["'])([^"']*)\1/)?.[2]?.trim();
  if (type === 'groupchat') {
    return barePeer.trim() === '' ? null : bareJid(barePeer);
  }
  const from = stanzaFrom(xml);
  return from === null ? null : bareJid(from);
}

/** The origin id a correction or retraction row edits, or null when the row is
 * neither (search/snippet.ts:81,90). */
export function cardEditTarget(xml: string): string | null {
  return correctionTarget(xml) ?? retractTarget(xml);
}

/** True when a correction or retraction row edits a live-UI row, using the
 * live-UI origin ids a reader already read in the same batch. T-1414 card
 * corrections carry their own payload and match `isLiveAiUiRow` directly;
 * this catches an old server's payload-less edits. */
export function isLiveAiUiEdit(xml: string, liveIds: ReadonlySet<string>): boolean {
  const target = cardEditTarget(xml);
  return target !== null && liveIds.has(target);
}

/** The origin ids of the live-UI rows in one batch, so a reader can tell an
 * edit of a card from an edit of a real message. */
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
