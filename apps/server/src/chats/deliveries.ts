// Delivery marks store the caller's confirmation as an archive id in the AUTHOR's archive terms, forward only.
// A DM confirm reads the peer's rows in the author's archive; a group confirm reads the room's own rows.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { bareJid, ownBareJid } from '../jid';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { stanzaFrom } from '../search/snippet';
import type { TopicView } from '../topics/access';
import type { DeliveredNotice } from './delivered-notice';
import type { ChatUnread } from './unread';

export const DELIVERED_IDS_MAX = 50;
export const DELIVERED_ID_MAX_LENGTH = 128;

interface ArchiveDeliveryRow {
  timestamp: number | string | bigint;
  kind: string;
  nick: string;
  barePeer: string;
  xml: string;
  originId: string;
}

// A room row names the real sender in `bare_peer` (the nick is display text); DM rows match the stanza `from`.
// Only a row with no `bare_peer` falls back to the nick, case-insensitively.
function isCallerRow(
  row: Pick<ArchiveDeliveryRow, 'kind' | 'nick' | 'barePeer' | 'xml'>,
  allowed: SearchOwner,
  domain: string,
): boolean {
  if (row.kind === 'groupchat') {
    if (row.barePeer !== '') {
      return bareJid(row.barePeer) === ownBareJid(allowed, domain);
    }
    return row.nick !== '' && row.nick.toLowerCase() === allowed.ownLocalpart.toLowerCase();
  }
  const from = stanzaFrom(row.xml);
  return from !== null && bareJid(from) === ownBareJid(allowed, domain);
}

export type DeliveryScope =
  { kind: 'dm'; authorLocalpart: string; callerBareJid: string } | { kind: 'room'; room: string };

// Rows under the given origin ids in the author's scope that the caller did NOT write.
export async function archiveTimestampsForOrigins(
  archive: ArchivePool,
  allowed: SearchOwner,
  config: ServerConfig,
  scope: DeliveryScope,
  originIds: readonly string[],
): Promise<string[]> {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  let scopeText: string;
  if (scope.kind === 'dm') {
    const owner = next(scope.authorLocalpart);
    const peer = next(scope.callerBareJid);
    scopeText = `username = ${owner} AND bare_peer = ${peer}`;
  } else {
    const owner = next(scope.room);
    scopeText = `username = ${owner}`;
  }
  // Origin ids travel as decimal text (postgres.js would send a `bigint[]` as `10,20`) and bind as an array literal.
  const ids = next(`{${originIds.map((id) => `"${id.replaceAll('"', '""')}"`).join(',')}}`);
  const rows = (await archive.query(
    `SELECT kind, nick, bare_peer AS "barePeer", xml, timestamp, origin_id AS "originId" FROM archive
     WHERE ${scopeText} AND origin_id = ANY(${ids})`,
    values,
  )) as unknown as ArchiveDeliveryRow[];
  return rows
    .filter((row) => !isCallerRow(row, allowed, config.xmpp.domain))
    .map((row) =>
      typeof row.timestamp === 'bigint' ? row.timestamp.toString() : String(row.timestamp),
    );
}

// Stores the mark, keeping the larger id (microsecond timestamps); reports whether it moved so only a forward step notifies.
export async function putChatDelivery(
  db: ServerDatabase,
  options: { bare: string; userId: string; deliveredId: string },
): Promise<boolean> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The `WHERE` keeps forward-only atomic, so two racing devices cannot move it back.
      // A legacy non-numeric `delivered_id` falls out of the comparison and the write wins.
      return yield* sql<{
        deliveredId: string;
      }>`INSERT INTO chat_deliveries (user_id, chat_jid, delivered_id, updated_at)
        VALUES (${options.userId}, ${options.bare}, ${options.deliveredId}, now())
        ON CONFLICT (user_id, chat_jid) DO UPDATE SET
          delivered_id = EXCLUDED.delivered_id,
          updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.delivered_id::bigint > chat_deliveries.delivered_id::bigint
        RETURNING delivered_id`;
    }),
  );
  return rows.length > 0;
}

// A DM entry names the peer's user id; a group or topic entry names the room JID.
export interface DeliveryLookup {
  chatJid: string;
  dmPeerUserId?: string;
  roomJid?: string;
}

// A DM carries the peer's mark; a group or topic the highest of any other member. One query per kind.
export async function deliveredForChats(
  db: ServerDatabase,
  options: { userId: string; callerJid: string; lookups: DeliveryLookup[] },
): Promise<Record<string, string>> {
  const { userId, callerJid } = options;
  const peerIds = options.lookups.flatMap((lookup) =>
    lookup.dmPeerUserId === undefined ? [] : [lookup.dmPeerUserId],
  );
  const roomJids = options.lookups.flatMap((lookup) =>
    lookup.roomJid === undefined ? [] : [lookup.roomJid.toLowerCase()],
  );
  const [dmRows, roomRows] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The DM arm keys on the peer's user id under the caller's JID, so another peer's confirm cannot leak in.
      const dm =
        peerIds.length === 0
          ? []
          : yield* sql<{
              userId: string;
              deliveredId: string;
            }>`SELECT user_id, max(delivered_id::bigint) AS delivered_id
            FROM chat_deliveries
            WHERE chat_jid = ${callerJid.toLowerCase()} AND user_id IN ${sql.in(peerIds)}
            GROUP BY user_id`;
      const rooms =
        roomJids.length === 0
          ? []
          : yield* sql<{
              chatJid: string;
              deliveredId: string;
            }>`SELECT chat_jid, max(delivered_id::bigint) AS delivered_id
            FROM chat_deliveries
            WHERE user_id <> ${userId} AND chat_jid IN ${sql.in(roomJids)}
            GROUP BY chat_jid`;
      return [dm, rooms] as const;
    }),
  );
  const byPeer = new Map(dmRows.map((row) => [row.userId, String(row.deliveredId)]));
  const byRoom = new Map(
    roomRows.map((row) => [row.chatJid.toLowerCase(), String(row.deliveredId)]),
  );
  const answer: Record<string, string> = {};
  for (const lookup of options.lookups) {
    const mark =
      lookup.dmPeerUserId !== undefined
        ? byPeer.get(lookup.dmPeerUserId)
        : lookup.roomJid !== undefined
          ? byRoom.get(lookup.roomJid.toLowerCase())
          : undefined;
    if (mark !== undefined && mark !== null) {
      answer[lookup.chatJid] = mark;
    }
  }
  return answer;
}

// Microsecond decimal ids compared as numbers, never `BigInt`; non-numeric ids sort below numeric ones.
function compareArchiveIds(left: string, right: string): number {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const trimmedLeft = left.replace(/^0+(?=[0-9])/, '');
    const trimmedRight = right.replace(/^0+(?=[0-9])/, '');
    if (trimmedLeft.length !== trimmedRight.length) {
      return trimmedLeft.length < trimmedRight.length ? -1 : 1;
    }
    return trimmedLeft < trimmedRight ? -1 : trimmedLeft > trimmedRight ? 1 : 0;
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? 1 : -1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

// The max of a non-empty id list, compared as decimals, never `BigInt`.
export function maxArchiveId(ids: [string, ...string[]]): string {
  let best = ids[0];
  for (const candidate of ids) {
    if (compareArchiveIds(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best;
}

// Room scope is the room's own archive, else the peer's localpart taken as-is from the bare JID.
export async function deliveryScopeForChat(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
  bare: string,
): Promise<DeliveryScope> {
  const allowed = await allowedArchives(db, config, userId);
  const room = allowed.rooms.find((entry) => entry.toLowerCase() === bare);
  if (room !== undefined) {
    return { kind: 'room', room: bare };
  }
  return {
    kind: 'dm',
    authorLocalpart: bare.slice(0, bare.indexOf('@')),
    callerBareJid: ownBareJid(allowed, config.xmpp.domain),
  };
}

export interface TopicMarks {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
  deliveredUntil?: string;
}

export function mergeTopicMarks(
  topics: TopicView[],
  unread: Record<string, ChatUnread>,
  deliveredMarks: Record<string, string>,
): Array<TopicView & TopicMarks> {
  return (topics as Array<TopicView & TopicMarks>).map((topic) => {
    const topicFields = unread[topic.chatJid];
    const topicDelivered = deliveredMarks[topic.chatJid];
    if (topicFields === undefined && topicDelivered === undefined) {
      return topic;
    }
    const merged: TopicView & TopicMarks = { ...topic };
    if (topicFields !== undefined) {
      merged.unread = topicFields.unread;
      if (topicFields.lastMessage !== undefined) {
        merged.lastMessage = topicFields.lastMessage;
      }
    }
    if (topicDelivered !== undefined) {
      merged.deliveredUntil = topicDelivered;
    }
    return merged;
  });
}

// Stores the mark from the confirmed origin ids, or writes nothing; returns the notice data only when a DM mark moved.
export async function putDeliveredMark(
  db: ServerDatabase,
  config: ServerConfig,
  archive: ArchivePool | undefined,
  options: { bare: string; userId: string; originIds: readonly string[] },
): Promise<DeliveredNotice | undefined> {
  if (archive === undefined) {
    return undefined;
  }
  const allowed = await allowedArchives(db, config, options.userId);
  const scope = await deliveryScopeForChat(db, config, options.userId, options.bare);
  const timestamps = await archiveTimestampsForOrigins(
    archive,
    allowed,
    config,
    scope,
    options.originIds,
  );
  // Nothing found: no write; otherwise the max id, compared as decimals and bound as a string.
  const [first, ...rest] = timestamps;
  if (first === undefined) {
    return undefined;
  }
  const until = maxArchiveId([first, ...rest]);
  const moved = await putChatDelivery(db, {
    bare: options.bare,
    userId: options.userId,
    deliveredId: until,
  });
  // Only a moved DM mark notifies; a room has no per-resource fan-out here.
  if (!moved || scope.kind !== 'dm') {
    return undefined;
  }
  return { authorBare: options.bare, chatJid: scope.callerBareJid, until };
}
