// Live AI UI (T-1400): the progress card an AI posts and edits while a turn
// runs is not a chat message. One rule, shared by push, the unread/preview
// path, the memory indexer and the media extractor, so none of them drift.
// The audit (docs/audit/agent-ux-plan.md §2.3) calls it "live AI UI"; today the
// only kind is an `<agent>` payload of type `progress`, sent by the gateway
// (agents/gateway/live.ts) and edited in place with corrections. T-1414: the
// edit carries the same payload, so both the post and its edits read as
// live AI UI; a correction without a payload (an old server) is still caught
// by its target id.

import { decodePayload, type Payload } from '@zilar/protocol';
import { correctionTarget, retractTarget } from '../search/snippet';

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

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
  const match = AGENT_PATTERN.exec(xml);
  if (match === null) {
    return null;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok ? result.payload : null;
}

/** True when an archive row is the live AI UI itself: an `<agent>` payload of
 * type `progress`, the card the gateway posts and edits while a turn runs. */
export function isLiveAiUiRow(xml: string): boolean {
  return decodeAgentPayload(xml)?.type === 'progress';
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
export function liveAiUiIds(rows: readonly { originId: string; xml: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isLiveAiUiRow(row.xml)) {
      ids.add(row.originId);
    }
  }
  return ids;
}
