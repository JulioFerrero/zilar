// effect-plain: the preview is a Promise over the read-only ArchivePool; the Effect layer is topics/api.ts.
// The read-only preview of a public topic a group member has not joined.
// Topic rooms are members-only and their history lives in the MUC archive,
// so the server reads it like message search: one newest-first page, then
// the shared edit overlay.

import type { TopicPreviewMessage } from '@zilar/api-contract';
import { isAiJid } from '@zilar/protocol';
import { bareJid } from '../jid';
import { decodeAgentPayload, isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';
import { loadEditsForTargets } from '../search/edit-overlay';
import { correctionTarget, retractTarget, timestampToIso } from '../search/snippet';
import type { ArchivePool } from '../search/service';

/** How many messages the preview returns. */
export const TOPIC_PREVIEW_LIMIT = 30;
// Scan more than the page needs, so correction and retraction rows do not
// starve it.
export const TOPIC_PREVIEW_SCAN_LIMIT = 120;

const MESSAGE_COLUMNS = `nick, bare_peer AS "barePeer", origin_id AS "originId", timestamp, xml, txt AS "body"`;

// Every value travels as a `$n` binding, never string-built SQL; `roomJid`
// is the room's bare JID, the `username` of its archive rows.
function buildRowsQuery(roomJid: string): { text: string; values: unknown[] } {
  return {
    text: `SELECT ${MESSAGE_COLUMNS} FROM archive
      WHERE username = $1 AND kind = 'groupchat'
      ORDER BY timestamp DESC LIMIT $2`,
    values: [roomJid, TOPIC_PREVIEW_SCAN_LIMIT],
  };
}

/** The last `limit` messages of one room, oldest first. Corrections show
 * the newest body, retracted messages and the live AI card are dropped, and
 * a row with no body and no payload is not a message. `id` is the target
 * `origin_id`, so a message keeps one id across edits. */
export type RoomNameLookup = (jids: readonly string[]) => Promise<ReadonlyMap<string, string>>;

const NO_ROOM_NAMES: RoomNameLookup = async () => new Map();

export async function readTopicPreview(
  archive: ArchivePool,
  roomJid: string,
  limit = TOPIC_PREVIEW_LIMIT,
  loadRoomNames: RoomNameLookup = NO_ROOM_NAMES,
): Promise<TopicPreviewMessage[]> {
  const rowsQuery = buildRowsQuery(roomJid);
  const rows = await archive.query(rowsQuery.text, rowsQuery.values);
  const roomNames = await loadRoomNames(rows.map((row) => row.barePeer));

  // Only the original sender's correction or retraction counts.
  const targets = rows.flatMap((row) => {
    const target = correctionTarget(row.xml);
    return target === null || target === row.originId ? [row.originId] : [row.originId, target];
  });
  const overlay = await loadEditsForTargets(archive, { kind: 'room', room: roomJid }, targets);

  const liveIds = liveAiUiIds(rows);
  const seen = new Set<string>();
  const messages: TopicPreviewMessage[] = [];
  for (const row of rows) {
    // A retract row is never a message; its `txt` is the stock fallback.
    if (retractTarget(row.xml) !== null) {
      continue;
    }
    const correction = correctionTarget(row.xml);
    const key = correction ?? row.originId;
    const entry = overlay.get(key);
    if (entry?.retracted === true) {
      continue;
    }
    // A correction is the message only when it is the newest accepted one; the
    // row it supersedes is hidden, and another sender has no overlay entry.
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
    // The live progress card is not a message and neither is an edit of one;
    // `liveIds` is what this batch already read.
    if (isLiveAiUiRow(row.xml, row.barePeer) || isLiveAiUiEdit(row.xml, liveIds)) {
      continue;
    }
    const body = row.body ?? '';
    // Only an AI may draw a card in the preview: a person can post a `blocks` or
    // `progress` payload, and non-members see this without a sender to check.
    const payload = isAiJid(bareJid(row.barePeer)) ? decodeAgentPayload(row.xml) : null;
    if (body === '' && payload === null) {
      continue;
    }
    messages.push({
      id: key,
      at: timestampToIso(row.timestamp),
      // The real sender's database name; the nick only for an old row with no
      // `bare_peer`.
      nick: roomNames.get(bareJid(row.barePeer)) ?? row.nick,
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
