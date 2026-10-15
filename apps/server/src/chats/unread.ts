// Unread counts and previews for the chat list (T-1198): per chat, the
// number of archived messages after the caller's read mark plus the newest
// archived message. At most two archive queries per list, whatever the chat
// count; without an archive pool the answer is empty and the list omits both
// fields.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import type { ChatReadRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { bareJid, ownBareJid } from '../jid';
import { liveAiUiIds } from '../notify/ai-cards';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { stanzaFrom, timestampToIso } from '../search/snippet';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { localpartFor } from '../xmpp/provisioning';
import {
  buildNewestQuery,
  buildUnreadQuery,
  NO_MARK_WINDOW_DAYS,
  UNREAD_CAP,
  type ArchiveUnreadRow,
  type ChatThreshold,
} from './unread-queries';
import { newestUnskippedRow, skipUnreadRow } from './unread-skip';

export interface ChatUnread {
  unread: number;
  lastMessage?: {
    id: string;
    text: string;
    senderName?: string;
    at: string;
    /** The row's archive timestamp as a decimal string (T-1214): the read
     * mark for this preview. The origin id above is not a mark. */
    archiveId: string;
  };
}

export type UnreadScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

// The row's archive timestamp as a decimal string (T-1214): the read mark
// for the preview. Stringify only — never construct a `BigInt`, so no
// `BigInt` value reaches postgres.js (the T-1198 incident, T-1205).
function archiveIdOf(timestamp: number | string | bigint): string {
  return typeof timestamp === 'bigint' ? timestamp.toString() : String(timestamp);
}

// A non-text row gets a short label, like the clients' pin fallbacks
// (apps/web/src/components/PinsPanel.tsx:16-22).
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

// Whether the row was sent by the caller. Room rows name the sender's account
// localpart in `nick` (push/candidates.ts:86-88); DM rows are matched on the
// stanza's `from` like the search sender rule (search/snippet.ts:52-58).
function isOwnRow(
  row: Pick<ArchiveUnreadRow, 'kind' | 'nick' | 'xml'>,
  allowed: SearchOwner,
  ownLocalpart: string,
  domain: string,
): boolean {
  if (row.kind === 'groupchat') {
    return row.nick !== '' && row.nick === ownLocalpart;
  }
  const from = stanzaFrom(row.xml);
  return from !== null && bareJid(from) === ownBareJid(allowed, domain);
}

function senderNameForPreview(row: ArchiveUnreadRow, allowed: SearchOwner, ownJid: string): string {
  if (row.kind === 'groupchat') {
    return row.nick === '' ? 'Someone' : row.nick;
  }
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownJid) {
    return 'You';
  }
  return allowed.peerNames.get(row.barePeer) ?? 'Someone';
}

// Turns one chat's batch read into an unread count and a preview. A resent
// message reaches the archive as a second row under the same origin id (a lost
// stream-management ack makes the client resend, T-1217); per chat, the
// identity of a counted row is its sender plus that origin id. An album's
// photos archive as one row each under distinct origin ids but one album id
// (T-1267): `album:<id>` replaces the origin id, so the whole album counts
// once (T-1272). Rows arrive newest-first per chat (the join keeps each chat's
// order), so the first row kept per chat is its preview. The unread count
// stops at the cap: rows past it still set the preview but no longer bump the
// count.
export function summarizeUnread(
  page: ArchiveUnreadRow[],
  chats: ChatThreshold[],
  allowed: SearchOwner,
  ownLocalpart: string,
  ownJid: string,
  domain: string,
): Record<string, ChatUnread> {
  const answer: Record<string, ChatUnread> = {};
  const counted = new Map<string, Set<string>>();
  // The batch's live-UI origin ids, read once for the skip below (T-1400).
  const liveIds = liveAiUiIds(page);
  for (const row of page) {
    const chat = chats.find((entry) => entry.jid.toLowerCase() === row.chatJid.toLowerCase());
    if (chat === undefined) {
      continue;
    }
    // The live AI UI and its edits are not messages: they neither count nor
    // become the preview, so the loop keeps walking to the newest real message.
    if (skipUnreadRow(row.xml, liveIds)) {
      continue;
    }
    const current = answer[chat.jid];
    if (current?.lastMessage === undefined) {
      answer[chat.jid] = {
        unread: 0,
        lastMessage: {
          id: row.originId,
          text: labelForRow(row.text, row.xml),
          senderName: senderNameForPreview(row, allowed, ownJid),
          at: timestampToIso(row.timestamp),
          archiveId: archiveIdOf(row.timestamp),
        },
      };
    }
    if (!isOwnRow(row, allowed, ownLocalpart, domain)) {
      let seen = counted.get(chat.jid);
      if (seen === undefined) {
        seen = new Set<string>();
        counted.set(chat.jid, seen);
      }
      const album = albumInfoFromXml(row.xml);
      const identity = album === undefined ? row.originId : `album:${album.id}`;
      const key = `${row.kind}\u0000${row.barePeer}\u0000${row.nick}\u0000${identity}`;
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

/**
 * Unread counts and previews for the caller's chats. The input maps each
 * visible chat JID to its archive scope; only scoped chats are read, so a
 * chat the caller may not see never appears in the answer. At most two
 * archive queries in total.
 */
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
  const ownLocalpart = localpartFor(userId);
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
    // A stored mark is always numeric (writes validate it); a legacy row
    // that is not parses as no mark rather than failing the list.
    let after = floor;
    const mark = markByJid.get(jid.toLowerCase());
    if (mark !== undefined) {
      try {
        const parsed = BigInt(mark);
        // Decimal strings only: a mark that fits int8 stringifies exactly,
        // so postgres.js binds text and the `::bigint[]` cast compares it
        // as a number. Never pass a JS BigInt to the archive pool.
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

  const answer = summarizeUnread(page, chats, allowed, ownLocalpart, ownJid, config.xmpp.domain);

  const missing = chats.filter((chat) => answer[chat.jid]?.lastMessage === undefined);
  const newest = buildNewestQuery(allowed, missing);
  if (newest !== null) {
    const rows = (await archive.query(newest.text, newest.values)) as unknown as ArchiveUnreadRow[];
    for (const chat of missing) {
      // Newest first: the first row that is neither live AI UI nor an edit of
      // one is the preview, so a chat the card alone pushed past its mark
      // keeps showing its newest real message (T-1400).
      const row = newestUnskippedRow(rows, chat.jid);
      if (row === undefined) {
        continue;
      }
      answer[chat.jid] = {
        unread: 0,
        lastMessage: {
          id: row.originId,
          text: labelForRow(row.text, row.xml),
          senderName: senderNameForPreview(row, allowed, ownJid),
          at: timestampToIso(row.timestamp),
          archiveId: archiveIdOf(row.timestamp),
        },
      };
    }
  }
  return answer;
}
