// Delivery marks (T-1229): `PUT /api/chats/:jid/delivered` stores the
// caller's confirmation that their device holds messages, and `/api/chats`
// reports each chat's mark to the sender. The mark is an archive id in the
// AUTHOR's archive terms (like `chat_reads`, but the other side's mark): a
// DM confirm reads the max archive timestamp of the peer's rows in the
// author's archive; a group confirm reads the max timestamp of the room's
// own archive rows. Forward only, like `putChatRead`.

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

// Whether the archive row was written by the confirming caller. A room row
// names the real sender in `bare_peer`, not in the free-text nick (the nick is
// display text); DM rows match on the stanza's `from` like the unread own-row
// rule (chats/unread.ts `isOwnRow`). Only a row with no `bare_peer` at all
// (a legacy or malformed row) falls back to the nick, case-insensitively.
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

/**
 * The archive timestamps of the caller's confirmed messages: rows under the
 * given origin ids in the author's archive scope that the caller did NOT
 * write. DM scope is the author's own `username` with the caller as
 * `bare_peer`; room scope is the room's own `username`.
 */
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
  // Decimal strings only (T-1205): postgres.js sends a JS `bigint[]` as the
  // malformed literal `10,20`, so origin ids travel as text (no numeric
  // cast: origin ids are opaque). The array is bound as a Postgres array
  // literal, like the `pgliteArchivePool` test fake does, because some
  // drivers serialize a JS array parameter as one text value.
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

/**
 * Stores the caller's delivery mark for one chat, keeping the larger archive
 * id (microsecond timestamps compare as numbers), so an old device cannot
 * move the mark back. Reports whether the mark moved, so only a real forward
 * step notifies the author's devices (T-1245).
 */
export async function putChatDelivery(
  db: ServerDatabase,
  options: { bare: string; userId: string; deliveredId: string },
): Promise<boolean> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The `WHERE` keeps the forward-only rule atomic, like `putChatRead`
      // (reads.ts:72-81): two devices racing cannot move the mark back
      // between the read above and this write. A legacy non-numeric row
      // compares as no row: the uncastable `delivered_id` falls out of the
      // comparison and the write wins. `RETURNING` tells a moved write (one
      // row) from a no-op (zero rows).
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

/**
 * What one `/api/chats` entry needs to find its mark: a DM entry names the
 * peer's user id (the row's `user_id`; the stored `chat_jid` is the
 * caller's own JID), a group or topic entry names the room JID (any other
 * member's row counts).
 */
export interface DeliveryLookup {
  /** The `/api/chats` key the mark attaches to. */
  chatJid: string;
  dmPeerUserId?: string;
  roomJid?: string;
}

/**
 * Delivery marks for the caller's chats, in the caller's own-message terms:
 * a DM chat carries the peer's mark (stored under the caller's bare JID);
 * a group or topic chat carries the highest mark of any other member. One
 * query per kind in total (DM, room), whatever the chat count. Keys are the
 * chat JIDs the caller passed in.
 */
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
      // The DM arm matches rows by the peer's user id under the caller's
      // own JID (so another peer's confirm never leaks into this DM); the
      // room arm takes the max over any other member, grouped by chat (one
      // row per chat). Stored `chat_jid` values are normalised lowercase by
      // the access check, so the exact match uses the `chat_jid` index.
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

// Archive ids are microsecond-timestamp decimal strings (T-1205): compare
// them as numbers without ever constructing a `BigInt`, so no `BigInt`
// value reaches postgres.js. Non-numeric ids sort below any numeric one;
// two non-numeric ids compare as strings.
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

/**
 * The max of a non-empty id list, compared as decimals (never `BigInt`), so
 * the confirmed mark stays a plain string for postgres.js.
 */
export function maxArchiveId(ids: [string, ...string[]]): string {
  let best = ids[0];
  for (const candidate of ids) {
    if (compareArchiveIds(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Which archive scope the caller's confirmation reads: the room's own
 * archive when the chat is a visible room, else the DM author's archive
 * (the peer's localpart, taken as-is from the bare JID — it IS the archive
 * username, never re-derived) with the caller as bare peer. Reads only
 * archives the caller may see, like the unread scopes.
 */
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

/** The mark fields a topic view may gain. Structurally the `ChatUnreadFields`
 * shape `api.ts` declares, so `api.ts` can assign the result without a cycle. */
export interface TopicMarks {
  unread?: number;
  lastMessage?: ChatUnread['lastMessage'];
  deliveredUntil?: string;
}

// Merges the unread and delivered marks into each topic view. A topic with
// neither mark keeps its shape.
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

/**
 * Stores the caller's delivery mark for one chat from the confirmed origin
 * ids: the max archive timestamp of the caller's own messages (compared as
 * decimals, never `BigInt` — T-1205), or no write at all when none is found.
 *
 * Returns the notice data when a **DM** mark actually moved, so the caller can
 * tell the author's online devices; a room mark, an unmoved mark and a missing
 * archive all return `undefined` (T-1245).
 */
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
  // Nothing found: no write. Otherwise the mark is the max confirmed
  // timestamp, compared as decimals (never `BigInt` — T-1205) and bound as
  // a string.
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
  // Only a moved DM mark notifies: a room has no per-resource fan-out in this
  // task (docs/plan/delivered-tick.md §3), and an unmoved mark changes nothing.
  if (!moved || scope.kind !== 'dm') {
    return undefined;
  }
  return { authorBare: options.bare, chatJid: scope.callerBareJid, until };
}
