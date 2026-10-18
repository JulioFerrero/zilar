// The unread/preview skip rule for live AI UI (T-1400). Kept out of
// `unread.ts` (which sits near the 400-line cap) so the counting loop stays
// small; the rule itself lives in `notify/ai-cards.ts`.

import { isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';

/** The row shape both unread reads return: the chat key, the archive timestamp,
 * the real sender's bare JID and the xml the skip rule reads. */
export interface UnreadSkipRow {
  chatJid: string;
  originId: string;
  barePeer: string;
  timestamp: number | string | bigint;
  xml: string;
}

/** True when a row is the live AI UI or an edit of one in the same batch, so
 * the unread count and the preview skip it and keep walking back. */
export function skipUnreadRow(
  xml: string,
  barePeer: string,
  liveIds: ReadonlySet<string>,
): boolean {
  return isLiveAiUiRow(xml, barePeer) || isLiveAiUiEdit(xml, liveIds);
}

// The archive timestamp is microseconds since the epoch; postgres.js hands a
// bigint back as a string, so it is normalised before comparing (never a JS
// `BigInt` into a query — this only sorts in memory).
function toMicros(value: number | string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function newestFirst(a: UnreadSkipRow, b: UnreadSkipRow): number {
  const left = toMicros(a.timestamp);
  const right = toMicros(b.timestamp);
  if (left === right) {
    return 0;
  }
  return left < right ? 1 : -1;
}

/** The newest row of one chat that is neither live AI UI nor an edit of one,
 * or undefined when the chat has only those. Sorted here, so the answer does
 * not depend on the order Postgres returns the rows in. */
export function newestUnskippedRow<T extends UnreadSkipRow>(
  rows: readonly T[],
  chatJid: string,
): T | undefined {
  const mine = rows
    .filter((row) => row.chatJid.toLowerCase() === chatJid.toLowerCase())
    .sort(newestFirst);
  const liveIds = liveAiUiIds(mine);
  return mine.find((row) => !skipUnreadRow(row.xml, row.barePeer, liveIds));
}
