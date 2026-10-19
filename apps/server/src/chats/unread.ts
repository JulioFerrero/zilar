import type { ChatLastMessage } from '@zilar/api-contract';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import type { ChatReadRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { bareJid, ownBareJid } from '../jid';
import { isLiveAiUiEdit, isLiveAiUiRow, liveAiUiIds } from '../notify/ai-cards';
import {
  allowedArchives,
  type ArchivePool,
  type ArchiveRow,
  type SearchOwner,
} from '../search/service';
import { stanzaFrom, timestampToIso } from '../search/snippet';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { senderNamesByJid } from '../xmpp/archive-sender';
const UNREAD_CAP = 100,
  NEWEST_SCAN_ROWS = 25,
  NO_MARK_WINDOW_DAYS = 30;
export type ChatUnread = { unread: number; lastMessage?: ChatLastMessage };
export type UnreadScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };
type ArchiveUnreadRow = Pick<
  ArchiveRow,
  'barePeer' | 'kind' | 'nick' | 'originId' | 'timestamp' | 'xml'
> & { chatJid: string; text: string | null };
type ChatThreshold = { jid: string; scope: UnreadScope; after: string };
export function toBigInt(value: number | string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
export function afterForMark(mark: string | undefined, floor: string): string {
  if (mark === undefined) return floor;
  try {
    return BigInt(mark).toString();
  } catch {
    return floor;
  }
}
function skipRow(xml: string, barePeer: string, liveIds: ReadonlySet<string>): boolean {
  return isLiveAiUiRow(xml, barePeer) || isLiveAiUiEdit(xml, liveIds);
}
export function newestUnskippedRow<T extends ArchiveUnreadRow>(
  rows: readonly T[],
  chatJid: string,
): T | undefined {
  const mine = rows.filter((row) => row.chatJid.toLowerCase() === chatJid.toLowerCase());
  const liveIds = liveAiUiIds(mine);
  return mine
    .filter((row) => !skipRow(row.xml, row.barePeer, liveIds))
    .sort((a, b) => Number(toBigInt(b.timestamp) - toBigInt(a.timestamp)))[0];
}
const LABELS = [
  ['sticker', 'Sticker'],
  ['voice', 'Voice message'],
  ['audio', 'Voice message'],
  ['image', 'Photo'],
] as const;
function labelForRow(text: string | null, xml: string): string {
  const album = albumInfoFromXml(xml);
  if (album !== undefined) return `${album.count} photos`;
  const trimmed = (text ?? '').trim();
  if (trimmed !== '') return trimmed;
  return LABELS.find(([token]) => xml.includes(token))?.[1] ?? 'File';
}
function senderJid(row: Pick<ArchiveUnreadRow, 'kind' | 'barePeer' | 'xml'>): string | null {
  if (row.kind === 'groupchat') return row.barePeer === '' ? null : bareJid(row.barePeer);
  const from = stanzaFrom(row.xml);
  return from === null ? null : bareJid(from);
}
export function isOwnRow(
  row: Pick<ArchiveUnreadRow, 'kind' | 'nick' | 'barePeer' | 'xml'>,
  ownJid: string,
): boolean {
  const sender = senderJid(row);
  if (sender !== null) return sender === ownJid;
  return (
    row.kind === 'groupchat' &&
    row.nick.toLowerCase() === (ownJid.split('@')[0] ?? '').toLowerCase()
  );
}
function senderJidsOf(rows: readonly ArchiveUnreadRow[]): string[] {
  return rows.flatMap((row) =>
    row.kind === 'groupchat' && row.barePeer !== '' ? [bareJid(row.barePeer)] : [],
  );
}
function previewOf(
  row: ArchiveUnreadRow,
  allowed: SearchOwner,
  ownJid: string,
  names: ReadonlyMap<string, string>,
): ChatLastMessage {
  const sender = senderJid(row);
  const named = sender === null ? undefined : (names.get(sender) ?? allowed.peerNames.get(sender));
  const senderName =
    row.kind === 'groupchat'
      ? (named ?? (row.nick === '' ? 'Someone' : row.nick))
      : sender === ownJid
        ? 'You'
        : (allowed.peerNames.get(row.barePeer) ?? 'Someone');
  return {
    id: row.originId,
    text: labelForRow(row.text, row.xml),
    senderName,
    at: timestampToIso(row.timestamp),
    archiveId: typeof row.timestamp === 'bigint' ? row.timestamp.toString() : String(row.timestamp),
  };
}
export function summarizeUnread(
  page: ArchiveUnreadRow[],
  chats: ChatThreshold[],
  allowed: SearchOwner,
  ownJid: string,
  roomNames: ReadonlyMap<string, string> = new Map(),
): Record<string, ChatUnread> {
  const answer: Record<string, ChatUnread> = {};
  const counted = new Set<string>();
  const liveIds = liveAiUiIds(page);
  for (const row of page) {
    const chat = chats.find((entry) => entry.jid.toLowerCase() === row.chatJid.toLowerCase());
    if (chat === undefined || skipRow(row.xml, row.barePeer, liveIds)) continue;
    const entry = (answer[chat.jid] ??= { unread: 0 });
    entry.lastMessage ??= previewOf(row, allowed, ownJid, roomNames);
    if (isOwnRow(row, ownJid)) continue;
    const album = albumInfoFromXml(row.xml);
    const key = `${chat.jid}\u0000${row.kind}\u0000${row.barePeer}\u0000${row.kind === 'groupchat' ? row.barePeer : row.nick}\u0000${album === undefined ? row.originId : `album:${album.id}`}`;
    if (counted.has(key)) continue;
    counted.add(key);
    if (entry.unread < UNREAD_CAP) entry.unread += 1;
  }
  return answer;
}
export async function unreadForChats(
  db: ServerDatabase,
  config: ServerConfig,
  archive: ArchivePool | undefined,
  userId: string,
  scopes: Map<string, UnreadScope>,
): Promise<Record<string, ChatUnread>> {
  if (archive === undefined || scopes.size === 0) return {};
  const allowed = await allowedArchives(db, config, userId);
  const ownJid = ownBareJid(allowed, config.xmpp.domain);
  const marks = await runSql(
    db,
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<ChatReadRow>`SELECT * FROM chat_reads WHERE user_id = ${userId}`,
    ),
  );
  const markByJid = new Map(marks.map((row) => [row.chatJid.toLowerCase(), row.lastReadId]));
  const floor = String(BigInt(Date.now() - NO_MARK_WINDOW_DAYS * 86_400_000) * 1000n);
  const chats = [...scopes]
    .filter(([, scope]) =>
      scope.kind === 'room'
        ? allowed.rooms.some((room) => room.toLowerCase() === scope.room.toLowerCase())
        : allowed.dmPeers.some((peer) => peer.toLowerCase() === scope.peer.toLowerCase()),
    )
    .map(([jid, scope]): ChatThreshold => {
      const mark = markByJid.get(jid.toLowerCase());
      return { jid, scope, after: afterForMark(mark, floor) };
    });
  if (chats.length === 0) return {};
  const [text, values] = batchQuery(allowed, chats, true);
  const page = (await archive.query(text, values)) as unknown as ArchiveUnreadRow[];
  const pageNames = await senderNamesByJid(db, senderJidsOf(page));
  const answer = summarizeUnread(page, chats, allowed, ownJid, pageNames);
  const missing = chats.filter((chat) => answer[chat.jid]?.lastMessage === undefined);
  if (missing.length === 0) return answer;
  const [newestText, newestValues] = batchQuery(allowed, missing, false);
  const rows = (await archive.query(newestText, newestValues)) as unknown as ArchiveUnreadRow[];
  const newestNames = await senderNamesByJid(db, senderJidsOf(rows));
  for (const chat of missing) {
    const row = newestUnskippedRow(rows, chat.jid);
    if (row !== undefined)
      answer[chat.jid] = { unread: 0, lastMessage: previewOf(row, allowed, ownJid, newestNames) };
  }
  return answer;
}
const ARCHIVE_LATERAL = `LEFT JOIN LATERAL ( SELECT bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, txt AS text, xml FROM archive WHERE username = scope.owner AND (scope.peer = '' OR bare_peer = scope.peer)`;
function batchQuery(
  allowed: SearchOwner,
  chats: ChatThreshold[],
  afterMark: boolean,
): [string, unknown[]] {
  const values: unknown[] = [];
  const add = (value: unknown): string => `$${values.push(value)}`;
  const keyList = add(chats.map((chat) => chat.jid.toLowerCase()));
  const ownerList = add(
    chats.map((chat) => (chat.scope.kind === 'room' ? chat.scope.room : allowed.ownLocalpart)),
  );
  const peerList = add(chats.map((chat) => (chat.scope.kind === 'room' ? '' : chat.scope.peer)));
  if (afterMark) {
    const markList = add(chats.map((chat) => chat.after));
    const cap = add(String(UNREAD_CAP + 1));
    return [
      `SELECT scope.chat_jid AS "chatJid", page."barePeer", page.kind, page.nick, page."originId", page.timestamp, page.text, page.xml FROM (SELECT unnest(${keyList}::text[]) AS chat_jid, unnest(${ownerList}::text[]) AS owner, unnest(${peerList}::text[]) AS peer, unnest(${markList}::bigint[]) AS mark) AS scope ${ARCHIVE_LATERAL} AND timestamp > scope.mark ORDER BY timestamp DESC LIMIT ${cap}) AS page ON true WHERE page."originId" IS NOT NULL`,
      values,
    ];
  }
  const cap = add(String(NEWEST_SCAN_ROWS));
  return [
    `SELECT scope.chat_jid AS "chatJid", newest."barePeer", newest.kind, newest.nick, newest."originId", newest.timestamp, newest.text, newest.xml FROM (SELECT unnest(${keyList}::text[]) AS chat_jid, unnest(${ownerList}::text[]) AS owner, unnest(${peerList}::text[]) AS peer) AS scope ${ARCHIVE_LATERAL} ORDER BY timestamp DESC LIMIT ${cap}) AS newest ON true WHERE newest."originId" IS NOT NULL ORDER BY scope.chat_jid, newest.timestamp DESC`,
    values,
  ];
}
