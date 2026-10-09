import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { decodePayload, type Payload } from '@zilar/protocol';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/routes';
import type { ArchivePool, ArchiveRow } from '../search/service';

// The MAM read bounds, copied from search (apps/server/src/search/routes.ts):
// no expression index is possible in the ejabberd database, so each pass reads
// newest-to-oldest within 12 months and at most 5 000 rows. The indexer reads
// the other way (ascending) to advance its cursor, and caps the stored rows
// per chat so a room cannot grow unbounded.
export const MEDIA_INDEX_MAX_ROWS = 5000;
export const MEDIA_ITEMS_CAP_PER_CHAT = 20000;
export const MEDIA_WINDOW_MONTHS = 12;
const MEDIA_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';

export interface ExtractedMediaItem {
  kind: MediaKind;
  url?: string | undefined;
  name?: string | undefined;
  mime?: string | undefined;
  size?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  durationMs?: number | undefined;
  waveform?: number[] | undefined;
  linkUrl?: string | undefined;
  linkHost?: string | undefined;
}

export interface MediaLink {
  url: string;
  host: string;
}

// How the archive is addressed, exactly as search scopes it: a room is
// `username = <room JID>`; a DM is `username = <own localpart> AND
// bare_peer = <peer bare JID>` (see search/routes.ts:200-207).
export type MediaChatScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

export interface IndexChatInput {
  archive: ArchivePool;
  db: ServerDatabase;
  /** The archive `username`: the room JID, or the DM owner's localpart. */
  archiveOwner: string;
  /** The chat JID clients address: the room JID, or the DM peer's bare JID. */
  chatJid: string;
  scope: MediaChatScope;
  now: Date;
  /** Overridable in tests; defaults to `MEDIA_ITEMS_CAP_PER_CHAT`. */
  maxRows?: number;
}

export interface IndexChatResult {
  /** Rows read from the archive on this pass. */
  read: number;
  /** Rows actually inserted (conflicts count nothing). */
  inserted: number;
  /** True when this pass reached the end of the window. */
  done: boolean;
}

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

// The parser unescapes the five XML entities (in this order, so an escaped
// ampersand is not double-decoded).
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// Small defensive regex readers, like `stanzaFrom`/`tagAttribute` in
// search/routes.ts — a missing or malformed element is null, never a throw.
function decodeAgentPayload(xml: string): Payload | null {
  const match = AGENT_PATTERN.exec(xml);
  if (match === null) {
    return null;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok ? result.payload : null;
}

// The link rule copied from `packages/chat-core/src/links.ts` (which the server
// does not depend on): only `http(s)` URLs, trailing sentence punctuation
// trimmed, a closing bracket kept only when the URL opened it. The host comes
// from `new URL`, so anything the parser rejects is dropped.
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
const ALWAYS_STRIP = new Set(['.', ',', ';', ':', '!', '?', '…', '»', '"', "'"]);
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function countCharacter(value: string, character: string): number {
  let total = 0;
  for (const item of value) {
    if (item === character) {
      total += 1;
    }
  }
  return total;
}

function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === undefined) {
      break;
    }
    if (ALWAYS_STRIP.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = Object.entries(BRACKETS).find(([, closer]) => closer === last)?.[0];
    if (opener !== undefined && countCharacter(url, last) > countCharacter(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

// The authority rule from `packages/chat-core/src/links.ts` (`toHref`): only a
// URL whose authority (the part before the path/query/fragment) contains a
// letter or digit becomes a link. `https://-/x` is dropped here, not by the URL
// parser.
function authorityOf(url: string): string {
  const match = /^https?:\/\//i.exec(url);
  if (match === null) {
    return '';
  }
  return url.slice(match[0].length).split(/[/?#]/, 1)[0] ?? '';
}

export function extractLinks(text: string): MediaLink[] {
  const links: MediaLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    if (raw === undefined) {
      continue;
    }
    const url = trimTrailingPunctuation(raw);
    if (!/[a-z0-9]/i.test(authorityOf(url))) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (host === '' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ url, host });
  }
  return links;
}

// The items in one archive row: an attachment or voice note plus every link in
// the body. Pure and total: malformed XML, invalid JSON or a bad payload gives
// only the links, or nothing.
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
  try {
    return extractMediaItemsUnsafe(row);
  } catch {
    return [];
  }
}

function extractMediaItemsUnsafe(row: ArchiveRow): ExtractedMediaItem[] {
  const items: ExtractedMediaItem[] = [];
  const payload = decodeAgentPayload(row.xml);
  if (payload !== null) {
    if (payload.type === 'attachment') {
      const attachment = payload.data;
      // A GIF is an attachment by storage and a distinct render kind by
      // convention (plan §3a): a `gif-` name with a video mime.
      const isGif = attachment.name.startsWith('gif-') && attachment.mime.startsWith('video/');
      items.push({
        kind: isGif ? 'gif' : attachment.kind,
        url: attachment.url,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
      });
    } else if (payload.type === 'voice') {
      items.push({
        kind: 'voice',
        url: payload.data.url,
        mime: payload.data.mime,
        durationMs: payload.data.duration_ms,
        waveform: payload.data.waveform,
      });
    }
  }
  for (const link of extractLinks(row.body ?? '')) {
    items.push({ kind: 'link', linkUrl: link.url, linkHost: link.host });
  }
  return items;
}

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// The `media_items` row the indexer writes. Local to this file now that the
// insert is raw SQL; the columns mirror the `media_items` migration SQL, and a
// `bigint` read would come back as a string (none is read here).
interface MediaItemRow {
  id: string;
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
  kind: MediaKind;
  url: string | null;
  name: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  linkUrl: string | null;
  linkHost: string | null;
  ref: string;
  deleted: boolean;
}

interface RowBase {
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
}

// `ref` is the row's identity inside its message: the URL for a media item,
// the link URL for a link. Empty only for a voice note without a URL, which is
// still unique by `kind`.
function toInsert(item: ExtractedMediaItem, base: RowBase): MediaItemRow {
  return {
    id: randomUUID(),
    archiveOwner: base.archiveOwner,
    chatJid: base.chatJid,
    messageId: base.messageId,
    atMicros: base.atMicros,
    senderJid: base.senderJid,
    kind: item.kind,
    url: item.url ?? null,
    name: item.name ?? null,
    mime: item.mime ?? null,
    size: item.size ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.durationMs ?? null,
    waveform: item.waveform ?? null,
    linkUrl: item.linkUrl ?? null,
    linkHost: item.linkHost ?? null,
    ref: item.url ?? item.linkUrl ?? '',
    deleted: false,
  };
}

// `ON CONFLICT (archive_owner, chat_jid, message_id, kind, ref) DO NOTHING`
// (the unique index at `schema.ts:1419-1426`) with `RETURNING`, so the count
// is the rows actually inserted and a re-run inserts nothing. `waveform` is
// jsonb, so it is stringified and cast; every other value binds directly.
function insertItems(
  sql: SqlClient.SqlClient,
  rows: MediaItemRow[],
): Effect.Effect<number, SqlError.SqlError> {
  if (rows.length === 0) {
    return Effect.succeed(0);
  }
  const tuples = rows.map(
    (row) => sql`(${row.id}, ${row.archiveOwner}, ${row.chatJid}, ${row.messageId},
      ${row.atMicros}, ${row.senderJid}, ${row.kind}, ${row.url}, ${row.name},
      ${row.mime}, ${row.size}, ${row.width}, ${row.height}, ${row.durationMs},
      ${row.waveform === null ? sql`NULL` : sql`${JSON.stringify(row.waveform)}::jsonb`},
      ${row.linkUrl}, ${row.linkHost}, ${row.ref}, ${row.deleted})`,
  );
  return sql<{ id: string }>`INSERT INTO media_items (
      id, archive_owner, chat_jid, message_id, at_micros, sender_jid, kind,
      url, name, mime, size, width, height, duration_ms, waveform,
      link_url, link_host, ref, deleted)
    VALUES ${sql.csv(tuples)}
    ON CONFLICT (archive_owner, chat_jid, message_id, kind, ref) DO NOTHING
    RETURNING id`.pipe(Effect.map((inserted) => inserted.length));
}

// One fully parameterized query, like search's (`$n` bindings, never built SQL).
// Ascending so the cursor advances to the newest row read; strictly greater
// than the cursor so re-running never repeats a row.
export function buildIndexQuery(input: {
  archiveOwner: string;
  scope: MediaChatScope;
  cursorMicros: bigint;
  limit: number;
}): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const columns = `username AS owner, peer, bare_peer AS "barePeer", kind, nick,
    origin_id AS "originId", timestamp, xml, txt AS "body"`;
  const scope =
    input.scope.kind === 'room'
      ? `username = ${next(input.scope.room)}`
      : `username = ${next(input.archiveOwner)} AND bare_peer = ${next(input.scope.peer)}`;
  return {
    text: `SELECT ${columns} FROM archive WHERE ${scope} AND timestamp > ${next(input.cursorMicros)} ORDER BY timestamp ASC LIMIT ${next(input.limit)}`,
    values,
  };
}

function senderJidFor(row: ArchiveRow): string {
  return stanzaFrom(row.xml) ?? '';
}

export async function indexChat(input: IndexChatInput): Promise<IndexChatResult> {
  const { archive, db, archiveOwner, chatJid, scope, now } = input;
  const maxRows = input.maxRows ?? MEDIA_ITEMS_CAP_PER_CHAT;
  const cutoffMicros = BigInt(now.getTime() - MEDIA_WINDOW_MS) * 1000n;

  const state = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ indexedThroughMicros: string }>`SELECT indexed_through_micros
        FROM media_index_state
        WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
        LIMIT 1`;
    }),
  );
  const stored = state[0]?.indexedThroughMicros;
  const storedMicros = stored === undefined ? cutoffMicros : BigInt(stored);
  // Never read older than the 12-month window, even if the cursor is stale.
  const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

  const built = buildIndexQuery({ archiveOwner, scope, cursorMicros, limit: MEDIA_INDEX_MAX_ROWS });
  const rows = await archive.query(built.text, built.values);

  const result = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      let inserted = 0;
      let lastMicros: bigint | null = null;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const row of rows) {
            const atMicros = Number(BigInt(row.timestamp));
            lastMicros = BigInt(row.timestamp);
            const senderJid = senderJidFor(row);
            const base = { archiveOwner, chatJid, atMicros, senderJid };

            // A correction names its target: the new text replaces the target's
            // links. The correction row itself is never indexed.
            const corrected = correctionTarget(row.xml);
            if (corrected !== null) {
              yield* sql`DELETE FROM media_items
                WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
                  AND message_id = ${corrected} AND kind = 'link'`;
              const links = extractLinks(row.body ?? '').map((link) =>
                toInsert(
                  { kind: 'link', linkUrl: link.url, linkHost: link.host },
                  { ...base, messageId: corrected },
                ),
              );
              inserted += yield* insertItems(sql, links);
              continue;
            }

            // A retraction hides every row of the target message, links included.
            const retracted = retractTarget(row.xml);
            if (retracted !== null) {
              yield* sql`UPDATE media_items SET deleted = true
                WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
                  AND message_id = ${retracted}`;
              continue;
            }

            const items = extractMediaItems(row);
            if (items.length > 0) {
              inserted += yield* insertItems(
                sql,
                items.map((item) => toInsert(item, { ...base, messageId: row.originId })),
              );
            }
          }

          if (lastMicros !== null) {
            const through = Number(lastMicros);
            yield* sql`INSERT INTO media_index_state
                (archive_owner, chat_jid, indexed_through_micros, updated_at)
              VALUES (${archiveOwner}, ${chatJid}, ${through}, ${now})
              ON CONFLICT (archive_owner, chat_jid)
              DO UPDATE SET indexed_through_micros = ${through}, updated_at = ${now}`;
          }

          // One atomic statement prunes the chat down to the cap, oldest first.
          // The cap is never a check-then-insert.
          yield* sql`DELETE FROM media_items WHERE id IN (
            SELECT id FROM media_items
            WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
            ORDER BY at_micros DESC, id DESC
            OFFSET ${maxRows}
          )`;
        }),
      );

      return { inserted };
    }),
  );

  return { read: rows.length, inserted: result.inserted, done: rows.length < MEDIA_INDEX_MAX_ROWS };
}
