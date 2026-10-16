// effect-plain: the topic preview is a Promise over the read-only ArchivePool,
// the same Promise edge search/service.ts wraps; the Effect layer is topics/api.ts.
// T-1774: the read-only preview of a public topic a group member has not
// joined. Topic rooms are members-only and their history lives in the
// ejabberd MUC archive, so a non-member cannot fetch it over XMPP; the server
// reads the archive for them, exactly like message search
// (`../search/routes.ts`): one newest-first page of rows, one bounded query
// for the corrections and retractions, then the same newest-wins merge.

import type { TopicPreviewMessage } from '@zilar/api-contract';
import { decodeAgentPayload, isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';
import { correctionTarget, retractTarget, timestampToIso } from '../search/snippet';
import type { ArchivePool } from '../search/service';

/** How many messages the preview returns. */
export const TOPIC_PREVIEW_LIMIT = 30;
// Scan more than the page needs, so correction and retraction rows (which
// count against the limit but are not messages) do not starve it.
export const TOPIC_PREVIEW_SCAN_LIMIT = 120;

const MESSAGE_COLUMNS = `nick, origin_id AS "originId", timestamp, xml, txt AS "body"`;

// Every value travels as a `$n` binding, never string-built SQL; `roomJid` is
// the room's bare JID, the `username` of its archive rows.
function buildRowsQuery(roomJid: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ${MESSAGE_COLUMNS} FROM archive
      WHERE username = $1 AND kind = 'groupchat'
      ORDER BY timestamp DESC LIMIT $2`,
    values: [roomJid, TOPIC_PREVIEW_SCAN_LIMIT],
  };
}

// Corrections and retractions name their target origin_id in the stanza but
// need not be messages themselves, so a second bounded query fetches them for
// the same room (same shape as `buildArchiveEditsQuery`).
function buildEditsQuery(roomJid: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ${MESSAGE_COLUMNS} FROM archive
      WHERE username = $1 AND kind = 'groupchat'
        AND (xml LIKE $2 OR xml LIKE $3)
      ORDER BY timestamp DESC LIMIT $4`,
    values: [
      roomJid,
      '%urn:xmpp:message-correct:0%',
      '%urn:xmpp:message-retract:1%',
      TOPIC_PREVIEW_SCAN_LIMIT,
    ],
  };
}

/**
 * The last `limit` messages of one room, oldest first. Corrections show the
 * newest body, retracted messages and the live AI progress card are dropped,
 * and a row with no body and no payload is not a message. `id` is the target
 * `origin_id`: a correction keeps it, so a message keeps one id across edits.
 */
export async function readTopicPreview(
  archive: ArchivePool,
  roomJid: string,
  limit = TOPIC_PREVIEW_LIMIT,
): Promise<TopicPreviewMessage[]> {
  const rowsQuery = buildRowsQuery(roomJid);
  const editsQuery = buildEditsQuery(roomJid);
  const [rows, editRows] = await Promise.all([
    archive.query(rowsQuery.text, rowsQuery.values),
    archive.query(editsQuery.text, editsQuery.values),
  ]);

  // Newest wins per target: a correction after a row replaces its body, and a
  // retraction after a row hides it (and every older correction of it).
  const latestByTarget = new Map<string, bigint>();
  const retractedByTarget = new Map<string, bigint>();
  for (const edit of editRows) {
    const at = BigInt(edit.timestamp);
    const corrected = correctionTarget(edit.xml);
    if (corrected !== null && (latestByTarget.get(corrected) ?? -1n) < at) {
      latestByTarget.set(corrected, at);
    }
    const retracted = retractTarget(edit.xml);
    if (retracted !== null && (retractedByTarget.get(retracted) ?? -1n) < at) {
      retractedByTarget.set(retracted, at);
    }
  }

  const liveIds = liveAiUiIds(rows);
  const seen = new Set<string>();
  const messages: TopicPreviewMessage[] = [];
  for (const row of rows) {
    // A retract row is never a message itself: its `txt` is the stock
    // fallback sentence.
    if (retractTarget(row.xml) !== null) {
      continue;
    }
    const key = correctionTarget(row.xml) ?? row.originId;
    const at = BigInt(row.timestamp);
    const retractedAt = retractedByTarget.get(key);
    if (retractedAt !== undefined && retractedAt >= at) {
      continue;
    }
    const latestAt = latestByTarget.get(key);
    if (latestAt !== undefined && latestAt > at) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // The live progress card an AI posts and edits while a turn runs is not a
    // chat message (T-1400), and neither is an edit of one: the card carries
    // the payload, so `liveIds` is what this batch already read.
    if (isLiveAiUiRow(row.xml) || isLiveAiUiEdit(row.xml, liveIds)) {
      continue;
    }
    const body = row.body ?? '';
    const payload = decodeAgentPayload(row.xml);
    if (body === '' && payload === null) {
      continue;
    }
    messages.push({
      id: key,
      at: timestampToIso(row.timestamp),
      nick: row.nick,
      body,
      ...(payload === null ? {} : { payload }),
    });
    if (messages.length >= limit) {
      break;
    }
  }

  // The rows arrive newest first; the preview reads oldest first.
  return messages.reverse();
}
