// Mirrors an AI chat's archive into `ai_memory_messages` (T-0437, plan §3.2).
// Same shape as the media indexer: a cursor-driven, bounded read of the AI's
// own archive. Text edits (corrections, retractions) rewrite the mirror and
// drop every summary that covers the message, which is rebuilt without it.

import { decodePayload } from '@zilar/protocol';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { correctionTarget, retractTarget, stanzaFrom } from '../../search/routes';
import { extractMediaItems, type ExtractedMediaItem } from '../../media/indexer';
import type { ArchivePool, ArchiveRow } from '../../search/service';

// The read bounds, copied from the media indexer (apps/server/src/media/indexer.ts):
// no expression index exists in the ejabberd database, so each pass reads the
// newest 12 months ascending, at most 5 000 rows, and stops at the cursor.
export const MEMORY_INDEX_MAX_ROWS = 5000;
export const MEMORY_TEXT_MAX = 1000;
const MEMORY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// The gateway's chat key: `dm:<owner bare JID>` or `room:<room JID>`.
export type MemoryScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };

export interface IndexMemoryInput {
  archive: ArchivePool;
  db: ServerDatabase;
  aiId: string;
  chatKey: string;
  /** The archive `username`: the AI's localpart for a DM, the room JID for a room. */
  archiveOwner: string;
  scope: MemoryScope;
  /** The AI's bare JID; its own archive rows are stored with the sender "AI". */
  aiBareJid: string;
  /** The DM owner's display name; defaults to "Owner". */
  ownerName?: string | undefined;
  now: Date;
}

export interface IndexMemoryResult {
  /** Rows read from the archive on this pass. */
  read: number;
  /** Rows actually inserted (conflicts count nothing). */
  inserted: number;
  /** True when this pass reached the end of the window. */
  done: boolean;
}

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer. The
// media indexer reads the same payload for attachments and voice notes; a
// sticker is the one kind it drops, so it is decoded here to become
// "[sticker]".
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function isSticker(row: ArchiveRow): boolean {
  const match = AGENT_PATTERN.exec(row.xml);
  if (match === null) {
    return false;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok && result.payload.type === 'sticker';
}

// Bare JID, lowercased: the comparison key for the AI's own messages.
function bareJid(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

function cutText(text: string): string {
  return text.length <= MEMORY_TEXT_MAX ? text : text.slice(0, MEMORY_TEXT_MAX);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// The placeholder for the first non-link item, or null when the row has only
// links (a link-only message keeps its body as the text).
function mediaPlaceholder(items: ExtractedMediaItem[]): string | null {
  for (const item of items) {
    if (item.kind === 'image') return `[image: ${item.name ?? ''}]`;
    if (item.kind === 'file') return `[file: ${item.name ?? ''}]`;
    if (item.kind === 'gif') return '[gif]';
    if (item.kind === 'voice') return `[voice ${formatDuration(item.durationMs ?? 0)}]`;
  }
  return null;
}

// The mirror text for one row: a media placeholder in front of the body, the
// body alone for a plain or link-only message, and empty when there is nothing
// to store.
export function memoryText(row: ArchiveRow): string {
  const body = (row.body ?? '').trim();
  const placeholder = mediaPlaceholder(extractMediaItems(row));
  if (placeholder !== null) {
    return cutText(body === '' ? placeholder : `${placeholder} ${body}`);
  }
  if (isSticker(row)) {
    return cutText(body === '' ? '[sticker]' : `[sticker] ${body}`);
  }
  return cutText(body);
}

function senderFor(input: IndexMemoryInput, row: ArchiveRow): string {
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === bareJid(input.aiBareJid)) {
    return 'AI';
  }
  if (input.scope.kind === 'room') {
    return row.nick;
  }
  return input.ownerName ?? 'Owner';
}

// One fully parameterized query, like the media indexer's (`$n` bindings, never
// built SQL). Ascending so the cursor advances to the newest row read.
function buildIndexQuery(input: {
  archiveOwner: string;
  scope: MemoryScope;
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

// Every statement in the indexer runs on the `effect/sql` client registered for
// the chat's database (see `../../effect/sql`); `indexMemory` itself stays
// `async` so its caller and tests keep their shape.
function targetSeq(
  aiId: string,
  chatKey: string,
  messageId: string,
): Effect.Effect<number | null, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ seq: number }>`SELECT seq FROM ai_memory_messages
      WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND message_id = ${messageId}
      LIMIT 1`;
    return rows[0]?.seq ?? null;
  });
}

// A node covers a message when `lo <= seq < hi`. Dropping them makes the tree a
// cache that is rebuilt without the edited or retracted message.
function dropCoveringNodes(
  aiId: string,
  chatKey: string,
  seq: number,
): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM ai_memory_nodes
      WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND lo <= ${seq} AND hi > ${seq}`;
  });
}

export async function indexMemory(input: IndexMemoryInput): Promise<IndexMemoryResult> {
  const { archive, db, aiId, chatKey, archiveOwner, scope, now } = input;
  const cutoffMicros = BigInt(now.getTime() - MEMORY_WINDOW_MS) * 1000n;
  const lockKey = `${aiId}|${chatKey}`;

  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The advisory lock serializes the two passes of one chat, and the cursor
      // is read inside the same transaction so two passes never interleave.
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

          // `indexed_through_micros` is a bigint: the client reads it back as a
          // string, so it is wrapped in `BigInt(...)` before the comparison.
          const state = yield* sql<{
            indexedThroughMicros: string | number;
          }>`SELECT indexed_through_micros
            FROM ai_memory_state
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey} LIMIT 1`;
          const stored = state[0]?.indexedThroughMicros;
          const storedMicros = stored === undefined ? cutoffMicros : BigInt(stored);
          // Never read older than the 12-month window, even if the cursor is stale.
          const cursorMicros = storedMicros > cutoffMicros ? storedMicros : cutoffMicros;

          const built = buildIndexQuery({
            archiveOwner,
            scope,
            cursorMicros,
            limit: MEMORY_INDEX_MAX_ROWS,
          });
          const rows = yield* Effect.promise(() => archive.query(built.text, built.values));
          const read = rows.length;
          const done = rows.length < MEMORY_INDEX_MAX_ROWS;

          const maxSeqRows = yield* sql<{ seq: number | null }>`SELECT max(seq) AS seq
            FROM ai_memory_messages WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
          let nextSeq = Number(maxSeqRows[0]?.seq ?? -1) + 1;

          let inserted = 0;
          let lastMicros: bigint | null = null;

          for (const row of rows) {
            lastMicros = BigInt(row.timestamp);

            // A correction replaces the target's text. The correction row itself
            // is never stored, and no seq is consumed.
            const corrected = correctionTarget(row.xml);
            if (corrected !== null) {
              const seq = yield* targetSeq(aiId, chatKey, corrected);
              if (seq !== null) {
                yield* sql`UPDATE ai_memory_messages
                  SET text = ${cutText((row.body ?? '').trim())}
                  WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND message_id = ${corrected}`;
                yield* dropCoveringNodes(aiId, chatKey, seq);
              }
              continue;
            }

            // A retraction deletes the target's text and drops its covering nodes.
            const retracted = retractTarget(row.xml);
            if (retracted !== null) {
              const seq = yield* targetSeq(aiId, chatKey, retracted);
              if (seq !== null) {
                yield* sql`UPDATE ai_memory_messages
                  SET deleted = true, text = ''
                  WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND message_id = ${retracted}`;
                yield* dropCoveringNodes(aiId, chatKey, seq);
              }
              continue;
            }

            const text = memoryText(row);
            if (text === '') {
              continue;
            }

            const atMicros = BigInt(row.timestamp);
            // The unique key is the dedup: a re-read (a forced-back cursor)
            // inserts nothing and consumes no seq, so seqs stay dense.
            const result = yield* sql<{ seq: number }>`INSERT INTO ai_memory_messages
              (ai_id, chat_key, seq, message_id, at, sender, text, deleted)
              VALUES (
                ${aiId}, ${chatKey}, ${nextSeq}, ${row.originId},
                ${new Date(Number(atMicros / 1000n))}, ${senderFor(input, row)}, ${text}, false
              )
              ON CONFLICT (ai_id, chat_key, message_id) DO NOTHING
              RETURNING seq`;
            if (result.length > 0) {
              nextSeq += 1;
              inserted += 1;
            }
          }

          if (lastMicros !== null) {
            const through = Number(lastMicros);
            yield* sql`INSERT INTO ai_memory_state (ai_id, chat_key, indexed_through_micros, updated_at)
              VALUES (${aiId}, ${chatKey}, ${through}, ${now})
              ON CONFLICT (ai_id, chat_key) DO UPDATE SET
                indexed_through_micros = EXCLUDED.indexed_through_micros,
                updated_at = EXCLUDED.updated_at`;
          }

          return { read, inserted, done };
        }),
      );
    }),
  );
}
