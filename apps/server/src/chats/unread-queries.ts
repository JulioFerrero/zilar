// The batch read and the newest-row fallback, each one query in total whatever the chat count.

import type { SearchOwner } from '../search/service';
import type { UnreadScope } from './unread';

// More than fit on a badge: the count stops here (one row past the cap).
export const UNREAD_CAP = 100;
// The fallback looks this far back per chat for the newest real message above a run of live-AI-UI rows.
export const NEWEST_SCAN_ROWS = 25;
// A chat with no read mark counts from here, so a first sign-in does not show thousands of old messages.
export const NO_MARK_WINDOW_DAYS = 30;

export interface ArchiveUnreadRow {
  chatJid: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  text: string | null;
  xml: string;
}

export interface ChatThreshold {
  jid: string;
  scope: UnreadScope;
  // Decimal strings, never JS `BigInt`: postgres.js sends a `bigint[]` as `10,20`; the `::bigint[]` cast compares as numbers.
  after: string;
}

// Per chat, rows after its threshold (read mark or 30-day floor), newest first, capped at 101, in one query.
// The caller passes only chats it may see; the caller's archive scope is applied inside.
export function buildUnreadQuery(
  allowed: SearchOwner,
  chats: ChatThreshold[],
): { text: string; values: unknown[] } | null {
  if (chats.length === 0) {
    return null;
  }
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const keys: string[] = [];
  const owners: string[] = [];
  const peers: string[] = [];
  const marks: string[] = [];
  for (const chat of chats) {
    keys.push(chat.jid.toLowerCase());
    if (chat.scope.kind === 'room') {
      owners.push(chat.scope.room);
      peers.push('');
    } else {
      owners.push(allowed.ownLocalpart);
      peers.push(chat.scope.peer);
    }
    marks.push(chat.after);
  }
  const keyList = next(keys);
  const ownerList = next(owners);
  const peerList = next(peers);
  const markList = next(marks);
  const cap = next(String(UNREAD_CAP + 1));
  return {
    text: `SELECT scope.chat_jid AS "chatJid", page."barePeer", page.kind,
      page.nick, page."originId", page.timestamp, page.text, page.xml
      FROM (SELECT unnest(${keyList}::text[]) AS chat_jid,
        unnest(${ownerList}::text[]) AS owner, unnest(${peerList}::text[]) AS peer,
        unnest(${markList}::bigint[]) AS mark) AS scope
      LEFT JOIN LATERAL (
        SELECT bare_peer AS "barePeer", kind, nick, origin_id AS "originId",
          timestamp, txt AS text, xml
        FROM archive
        WHERE username = scope.owner
          AND (scope.peer = '' OR bare_peer = scope.peer)
          AND timestamp > scope.mark
        ORDER BY timestamp DESC LIMIT ${cap}
      ) AS page ON true
      WHERE page."originId" IS NOT NULL`,
    values,
  };
}

// The newest row of every chat with no row after its mark, one query with a values list and `LATERAL`.
// A chat absent from the caller's scope matches nothing; reads `NEWEST_SCAN_ROWS` rows to walk past live-AI-UI rows.
export function buildNewestQuery(
  allowed: SearchOwner,
  missing: ChatThreshold[],
): { text: string; values: unknown[] } | null {
  if (missing.length === 0) {
    return null;
  }
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const keys: string[] = [];
  const owners: string[] = [];
  const peers: string[] = [];
  for (const chat of missing) {
    keys.push(chat.jid.toLowerCase());
    if (chat.scope.kind === 'room') {
      owners.push(chat.scope.room);
      peers.push('');
    } else {
      owners.push(allowed.ownLocalpart);
      peers.push(chat.scope.peer);
    }
  }
  const keyList = next(keys);
  const ownerList = next(owners);
  const peerList = next(peers);
  const cap = next(String(NEWEST_SCAN_ROWS));
  return {
    text: `SELECT scope.chat_jid AS "chatJid", newest."barePeer", newest.kind,
      newest.nick, newest."originId", newest.timestamp, newest.text, newest.xml
      FROM (SELECT unnest(${keyList}::text[]) AS chat_jid,
        unnest(${ownerList}::text[]) AS owner, unnest(${peerList}::text[]) AS peer) AS scope
      LEFT JOIN LATERAL (
        SELECT bare_peer AS "barePeer", kind, nick, origin_id AS "originId",
          timestamp, txt AS text, xml
        FROM archive
        WHERE username = scope.owner
          AND (scope.peer = '' OR bare_peer = scope.peer)
        ORDER BY timestamp DESC LIMIT ${cap}
      ) AS newest ON true
      WHERE newest."originId" IS NOT NULL
      ORDER BY scope.chat_jid, newest.timestamp DESC`,
    values,
  };
}
