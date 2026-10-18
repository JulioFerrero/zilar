// The skip rule for live AI UI lives in `notify/ai-cards.ts`.

import { isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';

// The row shape both unread reads return: chat key, timestamp, real sender and xml.
export interface UnreadSkipRow {
  chatJid: string;
  originId: string;
  barePeer: string;
  timestamp: number | string | bigint;
  xml: string;
}

// Live AI UI and edits of it are skipped so the count and preview keep walking back.
export function skipUnreadRow(
  xml: string,
  barePeer: string,
  liveIds: ReadonlySet<string>,
): boolean {
  return isLiveAiUiRow(xml, barePeer) || isLiveAiUiEdit(xml, liveIds);
}

// The timestamp is microseconds; postgres.js returns a bigint as a string, normalised before comparing in memory.
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

// Newest row that is neither live AI UI nor an edit; sorted here, independent of Postgres order.
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
