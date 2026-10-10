import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
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
