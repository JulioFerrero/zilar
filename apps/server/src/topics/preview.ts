// effect-plain: the topic preview is a Promise over the read-only ArchivePool,
// the same Promise edge search/service.ts wraps; the Effect layer is topics/api.ts.
// T-1774: the read-only preview of a public topic a group member has not
// joined. Topic rooms are members-only and their history lives in the
// ejabberd MUC archive, so a non-member cannot fetch it over XMPP; the server
// reads the archive for them, exactly like message search
// (`../search/routes.ts`): one newest-first page of rows, then the shared
// edit-overlay helper resolves that page's corrections and retractions
// (target count × 20 edit reads, same-sender only).

import type { TopicPreviewMessage } from '@zilar/api-contract';
import { decodeAgentPayload, isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';
import { loadEditsForTargets } from '../search/edit-overlay';
import { correctionTarget, retractTarget, timestampToIso } from '../search/snippet';
import type { ArchivePool } from '../search/service';

/** How many messages the preview returns. */
export const TOPIC_PREVIEW_LIMIT = 30;
// Scan more than the page needs, so correction and retraction rows (which
// count against the limit but are not messages) do not starve it.
export const TOPIC_PREVIEW_SCAN_LIMIT = 120;

const MESSAGE_COLUMNS = `nick, bare_peer AS "barePeer", origin_id AS "originId", timestamp, xml, txt AS "body"`;

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
  const rows = await archive.query(rowsQuery.text, rowsQuery.values);

  // Only the original sender's correction or retraction counts: the shared
  // helper drops an edit from anyone else.
  const targets = rows.flatMap((row) => {
    const target = correctionTarget(row.xml);
    return target === null || target === row.originId ? [row.originId] : [row.originId, target];
  });
  const overlay = await loadEditsForTargets(archive, { kind: 'room', room: roomJid }, targets);

  const liveIds = liveAiUiIds(rows);
  const seen = new Set<string>();
  const messages: TopicPreviewMessage[] = [];
  for (const row of rows) {
    // A retract row is never a message itself: its `txt` is the stock
    // fallback sentence.
    if (retractTarget(row.xml) !== null) {
      continue;
    }
    const correction = correctionTarget(row.xml);
    const key = correction ?? row.originId;
    const entry = overlay.get(key);
    if (entry?.retracted === true) {
      continue;
    }
    // A correction row is only the message when it is the newest accepted
    // correction; the original row it supersedes is hidden. An edit from
    // another sender has no overlay entry.
    if (correction !== null) {
      if (entry?.latestText === undefined || entry.latestText !== (row.body ?? '')) {
        continue;
      }
    } else if (entry?.latestText !== undefined) {
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
