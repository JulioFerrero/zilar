import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { Logger } from 'pino';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { correctionTarget, retractTarget, stanzaFrom } from '../search/routes';
import type { ArchivePool, ArchiveRow } from '../search/service';
import { extractLinks, extractMediaItems } from './extract';
import { insertItems, toInsert } from './rows';

export { extractLinks, extractMediaItems };

// The MAM read bounds, copied from search (apps/server/src/search/routes.ts):
// no expression index is possible in the ejabberd database, so each pass reads
// newest-to-oldest within 12 months and at most 5 000 rows. The indexer reads
// the other way (ascending) to advance its cursor, and caps the stored rows
// per chat so a room cannot grow unbounded.
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
  /** Optional log sink; a skipped row falls back to the console. */
  logger?: Pick<Logger, 'warn'>;
}

export interface IndexChatResult {
  /** Rows read from the archive on this pass. */
  read: number;
  /** Rows actually inserted (conflicts count nothing). */
  inserted: number;
  /** True when this pass reached the end of the window. */
  done: boolean;
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

// The author of a message the index has not seen: a text-only message leaves
// no `media_items` rows to compare against, so the archive answers instead.
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
    text: `SELECT xml FROM archive WHERE ${scopeSql(input, next)} AND origin_id = ${next(input.messageId)} ORDER BY timestamp ASC LIMIT 8`,
    values,
  };
}

function senderJidFor(row: ArchiveRow): string {
  return stanzaFrom(row.xml) ?? '';
}

interface IndexRowContext {
  archiveOwner: string;
  chatJid: string;
  atMicros: number;
  scope: MediaChatScope;
  archive: ArchivePool;
  /** Authors seen in this pass, keyed by origin id, edits excluded. */
  batchAuthors: ReadonlyMap<string, string>;
}

// A foreign correction of a message that never produced media rows has no
// `media_items` sender to compare. The archive still names the author, and an
// author the archive cannot prove is treated as foreign: the correction inserts
// nothing rather than letting another member's links onto the message.
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

// A failing row must not roll back the whole pass: each row runs in its own
// savepoint, so the cursor still moves past it and the next row is indexed.
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

// One archive row's work, in a savepoint of the surrounding pass. A correction
// and a retraction only touch the sender's own rows: a foreign edit neither
// deletes nor inserts anything, so it cannot hide another member's files.
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

      // A correction names its target: the new text replaces the target's
      // links. The correction row itself is never indexed.
      const corrected = correctionTarget(row.xml);
      if (corrected !== null) {
        // The target's rows belong to its author. If any of them names another
        // sender, this correction is foreign and is ignored whole.
        const owners = yield* sql<{ senderJid: string }>`SELECT DISTINCT sender_jid AS "senderJid"
          FROM media_items
          WHERE archive_owner = ${archiveOwner} AND chat_jid = ${chatJid}
            AND message_id = ${corrected}`;
        if (owners.some((owner) => owner.senderJid !== senderJid)) {
          return 0;
        }
        if (owners.length === 0) {
          // A text-only target has no rows, so the author comes from this pass
          // or from the archive. An archive failure is rethrown so the per-row
          // catch logs it and skips the row; an author the archive cannot name
          // counts as foreign.
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

      // A retraction hides every row of the target message, links included.
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
  // Never read older than the 12-month window, even if the cursor is stale.
  const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

  const built = buildIndexQuery({ archiveOwner, scope, cursorMicros, limit: MEDIA_INDEX_MAX_ROWS });
  const rows = await archive.query(built.text, built.values);
  // Edits are skipped: their own origin id must never lend them authorship of
  // the message they name.
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

          // One atomic statement prunes the chat's links down to the cap,
          // oldest first. The cap is never a check-then-insert, and it never
          // removes an image, file, voice or video row: the link flood is the
          // only thing a room can produce without limit.
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
