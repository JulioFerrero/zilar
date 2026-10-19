// Per chat, the count after the caller's read mark plus the newest preview; at most two queries per list.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import type { ChatReadRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { bareJid, ownBareJid } from '../jid';
import { liveAiUiIds, isLiveAiUiEdit, isLiveAiUiRow } from '../notify/ai-cards';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { stanzaFrom, timestampToIso } from '../search/snippet';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { senderNamesByJid } from '../xmpp/archive-sender';

// The skip rule for live AI UI lives in `notify/ai-cards.ts`.

// The row shape both unread reads return: chat key, timestamp, real sender and xml.
interface UnreadSkipRow {
  chatJid: string;
  originId: string;
  barePeer: string;
  timestamp: number | string | bigint;
  xml: string;
}

// Live AI UI and edits of it are skipped so the count and preview keep walking back.
function skipUnreadRow(xml: string, barePeer: string, liveIds: ReadonlySet<string>): boolean {
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
export interface ChatUnread {
  unread: number;
  lastMessage?: {
    id: string;
    text: string;
    senderName?: string;
    at: string;
    // The preview's read mark as a decimal string; the origin id is not a mark.
    archiveId: string;
  };
}

export type UnreadScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

// Stringify only — never a `BigInt`, so none reaches postgres.js.
function archiveIdOf(timestamp: number | string | bigint): string {
  return typeof timestamp === 'bigint' ? timestamp.toString() : String(timestamp);
}

// A non-text row gets a short label, like the clients' pin fallbacks.
function labelForRow(text: string | null, xml: string): string {
  const album = albumInfoFromXml(xml);
  if (album !== undefined) {
    return `${album.count} photos`;
  }
  const trimmed = (text ?? '').trim();
  if (trimmed !== '') {
    return trimmed;
  }
  if (xml.includes('sticker')) {
    return 'Sticker';
  }
  if (xml.includes('voice') || xml.includes('audio')) {
    return 'Voice message';
  }
  if (xml.includes('image')) {
    return 'Photo';
  }
  return 'File';
}

// A room row names the real sender in `bare_peer` (the nick is display text); DM rows match the stanza `from`.
// Only a row with no `bare_peer` falls back to the nick, case-insensitively.
function isOwnRow(
  row: Pick<ArchiveUnreadRow, 'kind' | 'nick' | 'barePeer' | 'xml'>,
  ownJid: string,
): boolean {
  if (row.kind === 'groupchat') {
    if (row.barePeer !== '') {
      return bareJid(row.barePeer) === ownJid;
    }
    const ownLocalpart = ownJid.split('@')[0] ?? '';
    return row.nick !== '' && row.nick.toLowerCase() === ownLocalpart.toLowerCase();
  }
  const from = stanzaFrom(row.xml);
  return from !== null && bareJid(from) === ownJid;
}

function senderNameForPreview(
  row: ArchiveUnreadRow,
  allowed: SearchOwner,
  ownJid: string,
  roomNames: ReadonlyMap<string, string>,
): string {
  if (row.kind === 'groupchat') {
    const sender = row.barePeer === '' ? null : bareJid(row.barePeer);
    const name =
      sender === null ? undefined : (roomNames.get(sender) ?? allowed.peerNames.get(sender));
    return name ?? (row.nick === '' ? 'Someone' : row.nick);
  }
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownJid) {
    return 'You';
  }
  return allowed.peerNames.get(row.barePeer) ?? 'Someone';
}

// The real sender JIDs of the batch's room rows, for one name lookup per read.
function senderJidsOf(rows: readonly ArchiveUnreadRow[]): string[] {
  return rows
    .filter((row) => row.kind === 'groupchat' && row.barePeer !== '')
    .map((row) => bareJid(row.barePeer));
}

// A resent message archives as a second row under the same origin id, so identity is sender plus origin id.
// An album's photos share one album id (`album:<id>`), so the whole album counts once.
// Rows arrive newest-first; the first kept per chat is the preview, and the count stops at the cap.
export function summarizeUnread(
  page: ArchiveUnreadRow[],
  chats: ChatThreshold[],
  allowed: SearchOwner,
  ownJid: string,
  roomNames: ReadonlyMap<string, string> = new Map(),
): Record<string, ChatUnread> {
  const answer: Record<string, ChatUnread> = {};
  const counted = new Map<string, Set<string>>();
  const liveIds = liveAiUiIds(page);
  for (const row of page) {
    const chat = chats.find((entry) => entry.jid.toLowerCase() === row.chatJid.toLowerCase());
    if (chat === undefined) {
      continue;
    }
    // Live AI UI and its edits neither count nor become the preview.
    if (skipUnreadRow(row.xml, row.barePeer, liveIds)) {
      continue;
    }
    const current = answer[chat.jid];
    if (current?.lastMessage === undefined) {
      answer[chat.jid] = {
        unread: 0,
        lastMessage: {
          id: row.originId,
          text: labelForRow(row.text, row.xml),
          senderName: senderNameForPreview(row, allowed, ownJid, roomNames),
          at: timestampToIso(row.timestamp),
          archiveId: archiveIdOf(row.timestamp),
        },
      };
    }
    if (!isOwnRow(row, ownJid)) {
      let seen = counted.get(chat.jid);
      if (seen === undefined) {
        seen = new Set<string>();
        counted.set(chat.jid, seen);
      }
      const album = albumInfoFromXml(row.xml);
      const identity = album === undefined ? row.originId : `album:${album.id}`;
      // The key names the real sender (`bare_peer`) for a room row, so a resend counts once whatever nick.
      const senderKey = row.kind === 'groupchat' ? row.barePeer : row.nick;
      const key = `${row.kind}\u0000${row.barePeer}\u0000${senderKey}\u0000${identity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const entry = answer[chat.jid];
      if (entry !== undefined && entry.unread < UNREAD_CAP) {
        entry.unread += 1;
      }
    }
  }
  return answer;
}

// Only scoped chats are read, so a chat the caller may not see never appears; at most two queries.
export async function unreadForChats(
  db: ServerDatabase,
  config: ServerConfig,
  archive: ArchivePool | undefined,
  userId: string,
  scopes: Map<string, UnreadScope>,
): Promise<Record<string, ChatUnread>> {
  if (archive === undefined || scopes.size === 0) {
    return {};
  }
  const allowed = await allowedArchives(db, config, userId);
  const ownJid = ownBareJid(allowed, config.xmpp.domain);

  const marks = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ChatReadRow>`SELECT * FROM chat_reads WHERE user_id = ${userId}`;
    }),
  );
  const markByJid = new Map(marks.map((row) => [row.chatJid.toLowerCase(), row.lastReadId]));

  const floor = String(BigInt(Date.now() - NO_MARK_WINDOW_DAYS * 24 * 60 * 60 * 1000) * 1000n);
  const chats: ChatThreshold[] = [];
  for (const [jid, scope] of scopes) {
    const chatKey = scope.kind === 'room' ? scope.room.toLowerCase() : scope.peer.toLowerCase();
    const inScope =
      scope.kind === 'room'
        ? allowed.rooms.some((room) => room.toLowerCase() === chatKey)
        : allowed.dmPeers.some((peer) => peer.toLowerCase() === chatKey);
    if (!inScope) {
      continue;
    }
    // A legacy non-numeric mark parses as no mark rather than failing the list.
    let after = floor;
    const mark = markByJid.get(jid.toLowerCase());
    if (mark !== undefined) {
      try {
        const parsed = BigInt(mark);
        // A decimal string binds exactly and the `::bigint[]` cast compares it as a number; never pass a JS BigInt.
        after = parsed.toString();
      } catch {
        after = floor;
      }
    }
    chats.push({ jid, scope, after });
  }
  if (chats.length === 0) {
    return {};
  }

  const built = buildUnreadQuery(allowed, chats);
  if (built === null) {
    return {};
  }
  const page = (await archive.query(built.text, built.values)) as unknown as ArchiveUnreadRow[];

  // One batched display-name lookup for the page's room senders, keyed by `bare_peer`.
  const pageNames = await senderNamesByJid(db, senderJidsOf(page));
  const answer = summarizeUnread(page, chats, allowed, ownJid, pageNames);

  const missing = chats.filter((chat) => answer[chat.jid]?.lastMessage === undefined);
  const newest = buildNewestQuery(allowed, missing);
  if (newest !== null) {
    const rows = (await archive.query(newest.text, newest.values)) as unknown as ArchiveUnreadRow[];
    const newestNames = await senderNamesByJid(db, senderJidsOf(rows));
    for (const chat of missing) {
      // The first row that is neither live AI UI nor an edit is the preview.
      const row = newestUnskippedRow(rows, chat.jid);
      if (row === undefined) {
        continue;
      }
      answer[chat.jid] = {
        unread: 0,
        lastMessage: {
          id: row.originId,
          text: labelForRow(row.text, row.xml),
          senderName: senderNameForPreview(row, allowed, ownJid, newestNames),
          at: timestampToIso(row.timestamp),
          archiveId: archiveIdOf(row.timestamp),
        },
      };
    }
  }
  return answer;
}
// The batch read and the newest-row fallback, each one query in total whatever the chat count.

// More than fit on a badge: the count stops here (one row past the cap).
const UNREAD_CAP = 100;
// The fallback looks this far back per chat for the newest real message above a run of live-AI-UI rows.
const NEWEST_SCAN_ROWS = 25;
// A chat with no read mark counts from here, so a first sign-in does not show thousands of old messages.
const NO_MARK_WINDOW_DAYS = 30;

interface ArchiveUnreadRow {
  chatJid: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  text: string | null;
  xml: string;
}

interface ChatThreshold {
  jid: string;
  scope: UnreadScope;
  // Decimal strings, never JS `BigInt`: postgres.js sends a `bigint[]` as `10,20`; the `::bigint[]` cast compares as numbers.
  after: string;
}

// Per chat, rows after its threshold (read mark or 30-day floor), newest first, capped at 101, in one query.
// The caller passes only chats it may see; the caller's archive scope is applied inside.
function buildUnreadQuery(
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
function buildNewestQuery(
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
