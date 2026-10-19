import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { Logger } from 'pino';
import type { ServerDatabase } from '../db/client';
import { errorClassName } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { bareJid } from '../jid';
import type { ArchivePool, ArchiveRow } from '../search/service';
import { extractLinks, extractMediaItems } from './extract';
import { randomUUID } from 'node:crypto';
import { type MediaItemRow } from '../db/rows-agents';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/snippet';

// The columns mirror the `media_items` migration SQL; a `bigint` read would come back as
// a string (none is read here). The insert leaves `created_at` to the database default.
type MediaItemInsertRow = Omit<MediaItemRow, 'createdAt'>;

interface RowBase {
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
}

// `ref` is the row's identity inside its message: the URL, or empty only for a voice
// note without one, which is still unique by `kind`.
function toInsert(item: ExtractedMediaItem, base: RowBase): MediaItemInsertRow {
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

// `ON CONFLICT ... DO NOTHING` with `RETURNING`, so the count is the rows actually
// inserted and a re-run inserts nothing. `waveform` is jsonb, so it is stringified and
// cast; 500 rows x 19 bindings stays well under Postgres's 65 535 parameters.
const INSERT_CHUNK_ROWS = 500;

function insertChunk(
  sql: SqlClient.SqlClient,
  rows: MediaItemInsertRow[],
): Effect.Effect<number, SqlError.SqlError> {
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

function insertItems(
  sql: SqlClient.SqlClient,
  rows: MediaItemInsertRow[],
): Effect.Effect<number, SqlError.SqlError> {
  if (rows.length === 0) {
    return Effect.succeed(0);
  }
  return Effect.gen(function* () {
    let inserted = 0;
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
      inserted += yield* insertChunk(sql, rows.slice(start, start + INSERT_CHUNK_ROWS));
    }
    return inserted;
  });
}
export { extractLinks, extractMediaItems };

// No expression index is possible in the ejabberd database, so each pass reads
// newest-to-oldest within 12 months and at most 5 000 rows. The stored rows per chat are
// capped so a room cannot grow unbounded.
export const MEDIA_INDEX_MAX_ROWS = 5000;
export const MEDIA_ITEMS_CAP_PER_CHAT = 20000;
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

// The archive is addressed as search scopes it: a room is `username = <room JID>`; a DM
// is `username = <own localpart> AND bare_peer = <peer bare JID>`.
export type MediaChatScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

export interface IndexChatInput {
  archive: ArchivePool;
  db: ServerDatabase;
  archiveOwner: string;
  chatJid: string;
  scope: MediaChatScope;
  now: Date;
  maxRows?: number;
  logger?: Pick<Logger, 'warn'>;
}

export interface IndexChatResult {
  read: number;
  inserted: number;
  done: boolean;
}

// One fully parameterized query (`$n` bindings, never built SQL). Ascending so the cursor
// advances, strictly greater than the cursor so a re-run never repeats a row.
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
  return {
    text: `SELECT ${columns} FROM archive WHERE ${scopeSql(input, next)} AND timestamp > ${next(input.cursorMicros)} ORDER BY timestamp ASC LIMIT ${next(input.limit)}`,
    values,
  };
}

function scopeSql(
  input: { archiveOwner: string; scope: MediaChatScope },
  next: (value: unknown) => string,
): string {
  return input.scope.kind === 'room'
    ? `username = ${next(input.scope.room)}`
    : `username = ${next(input.archiveOwner)} AND bare_peer = ${next(input.scope.peer)}`;
}

// A text-only message leaves no `media_items` rows, so the archive answers instead.
export function buildTargetAuthorQuery(input: {
  archiveOwner: string;
  scope: MediaChatScope;
  messageId: string;
}): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  return {
    text: `SELECT bare_peer AS "barePeer", kind, xml FROM archive WHERE ${scopeSql(input, next)} AND origin_id = ${next(input.messageId)} ORDER BY timestamp ASC LIMIT 8`,
    values,
  };
}

// A room row's real sender is the archived `bare_peer`: the stanza's `from` is
// `room/nick`, a free display name anyone can take. A DM row uses the stanza's bare `from`.
function senderJidFor(row: ArchiveRow): string {
  if (row.kind === 'groupchat') {
    return bareJid(row.barePeer);
  }
  return stanzaFrom(row.xml) ?? '';
}

interface IndexRowContext {
  archiveOwner: string;
  chatJid: string;
  atMicros: number;
  scope: MediaChatScope;
  archive: ArchivePool;
  batchAuthors: ReadonlyMap<string, string>;
}

// A foreign correction of a message with no media rows has no sender to compare. The
// archive still names the author, and an unprovable author is treated as foreign, so
// another member's links never land on the message.
async function archivedAuthor(
  archive: ArchivePool,
  scope: MediaChatScope,
  archiveOwner: string,
  messageId: string,
): Promise<string | null> {
  const built = buildTargetAuthorQuery({ archiveOwner, scope, messageId });
  const rows = await archive.query(built.text, built.values);
  for (const row of rows) {
    if (correctionTarget(row.xml) !== null || retractTarget(row.xml) !== null) {
      continue;
    }
    return senderJidFor(row);
  }
  return null;
}

// Each row runs in its own savepoint, so a failing row does not roll back the pass and the
// cursor still moves past it.
function logSkippedRow(
  logger: Pick<Logger, 'warn'> | undefined,
  messageId: string,
  error: unknown,
): void {
  const name = error instanceof Error ? error.name : String(error);
  if (logger !== undefined) {
    logger.warn({ messageId, err: name }, 'media index row skipped');
    return;
  }
  console.warn(`[media] index row skipped for message ${messageId}: ${name}`);
}

// A foreign edit neither deletes nor inserts anything, so it cannot hide another member's
// files.
function indexRow(
  sql: SqlClient.SqlClient,
  row: ArchiveRow,
  context: IndexRowContext,
): Effect.Effect<number, SqlError.SqlError | Error> {
  return sql.withTransaction(
    Effect.gen(function* () {
      const { archiveOwner, chatJid, atMicros, scope, archive, batchAuthors } = context;
      const senderJid = senderJidFor(row);
      const base = { archiveOwner, chatJid, atMicros, senderJid };

      // A correction names its target; the correction row itself is never indexed.
      const corrected = correctionTarget(row.xml);
      if (corrected !== null) {
        // If any of the target's rows names another sender, this correction is foreign.
        const owners = yield* sql<{ senderJid: string }>`SELECT DISTINCT sender_jid AS "senderJid"
          FROM media_items
          WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
            AND message_id = ${corrected}`;
        if (owners.some((owner) => owner.senderJid !== senderJid)) {
          return 0;
        }
        if (owners.length === 0) {
          // A text-only target has no rows, so the author comes from this pass or the
          // archive; an archive failure is rethrown and the row skipped.
          const author =
            batchAuthors.get(corrected) ??
            (yield* Effect.tryPromise({
              try: () => archivedAuthor(archive, scope, archiveOwner, corrected),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }));
          if (author !== senderJid) {
            return 0;
          }
        }
        yield* sql`DELETE FROM media_items
          WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
            AND message_id = ${corrected} AND kind = 'link'
            AND sender_jid = ${senderJid}`;
        const links = extractLinks(row.body ?? '').map((link) =>
          toInsert(
            { kind: 'link', linkUrl: link.url, linkHost: link.host },
            { ...base, messageId: corrected },
          ),
        );
        return yield* insertItems(sql, links);
      }

      const retracted = retractTarget(row.xml);
      if (retracted !== null) {
        yield* sql`UPDATE media_items SET deleted = true
          WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
            AND message_id = ${retracted} AND sender_jid = ${senderJid}`;
        return 0;
      }

      const items = extractMediaItems(row);
      if (items.length === 0) {
        return 0;
      }
      return yield* insertItems(
        sql,
        items.map((item) => toInsert(item, { ...base, messageId: row.originId })),
      );
    }),
  );
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
  const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

  const built = buildIndexQuery({ archiveOwner, scope, cursorMicros, limit: MEDIA_INDEX_MAX_ROWS });
  const rows = await archive.query(built.text, built.values);
  // Edits are skipped: their own origin id must never lend them authorship of the target.
  const batchAuthors = new Map<string, string>();
  for (const row of rows) {
    if (correctionTarget(row.xml) !== null || retractTarget(row.xml) !== null) {
      continue;
    }
    batchAuthors.set(row.originId, senderJidFor(row));
  }

  const result = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      let inserted = 0;
      let lastMicros: bigint | null = null;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          const rowContext = { archiveOwner, chatJid, scope, archive, batchAuthors };
          for (const row of rows) {
            const atMicros = Number(BigInt(row.timestamp));
            // The cursor moves for every row read, including one that fails.
            lastMicros = BigInt(row.timestamp);
            const outcome = yield* indexRow(sql, row, { ...rowContext, atMicros }).pipe(
              Effect.map((count) => ({ ok: true as const, count })),
              Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
            );
            if (outcome.ok) {
              inserted += outcome.count;
            } else {
              logSkippedRow(input.logger, row.originId, outcome.error);
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

          // One atomic statement prunes the chat's links to the cap, oldest first, never
          // check-then-insert, and never removes an image, file, voice or video row.
          yield* sql`DELETE FROM media_items WHERE id IN (
            SELECT id FROM media_items
            WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
              AND kind = 'link'
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

export interface IndexChatOnDemandInput extends IndexChatInput {
  logger: Pick<Logger, 'warn'>;
  userId: string;
  logMessage: string;
}

// A failed pass is logged with ids and the error name only, never message contents.
export async function indexChatOnDemand(input: IndexChatOnDemandInput): Promise<void> {
  const { logger, userId, logMessage, ...chat } = input;
  try {
    await indexChat(chat);
  } catch (error) {
    logger.warn({ userId, err: errorClassName(error) }, logMessage);
  }
}
