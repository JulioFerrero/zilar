import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { bareJid } from '../../jid';
import { decodeAgentPayload, isLiveAiUiRow } from '../../notify/ai-cards';
import { correctionTarget, retractTarget, stanzaFrom } from '../../search/routes';
import { extractMediaItems, type ExtractedMediaItem } from '../../media/indexer';
import { senderNamesByJid } from '../../xmpp/archive-sender';
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
  archiveOwner: string;
  scope: MemoryScope;
  aiBareJid: string;
  ownerName?: string | undefined;
  now: Date;
}

export interface IndexMemoryResult {
  read: number;
  inserted: number;
  done: boolean;
}

// The agent payload namespace lives in `notify/ai-cards.ts` (the one decoder
// the media extractor and this indexer share). A sticker is the one media kind
// this indexer drops, so it is decoded here to become "[sticker]".
function isSticker(row: ArchiveRow): boolean {
  return decodeAgentPayload(row.xml)?.type === 'sticker';
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

function mediaPlaceholder(items: ExtractedMediaItem[]): string | null {
  for (const item of items) {
    if (item.kind === 'image') return `[image: ${item.name ?? ''}]`;
    if (item.kind === 'file') return `[file: ${item.name ?? ''}]`;
    if (item.kind === 'gif') return '[gif]';
    if (item.kind === 'voice') return `[voice ${formatDuration(item.durationMs ?? 0)}]`;
  }
  return null;
}

export function memoryText(row: ArchiveRow): string {
  // The live AI UI is not a message: a progress card's stage text is not
  // something the AI should remember from the conversation.
  if (isLiveAiUiRow(row.xml, row.barePeer)) {
    return '';
  }
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

// The name stored for a room message: the real sender is the archived
// `bare_peer`, and our tables give their display name, so nobody can pose as
// another member with a nick. The nick is only a fallback for an old or
// malformed row with no `bare_peer`.
function senderFor(
  input: IndexMemoryInput,
  row: ArchiveRow,
  roomNames: ReadonlyMap<string, string>,
): string {
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === bareJid(input.aiBareJid)) {
    return 'AI';
  }
  if (input.scope.kind === 'room') {
    const sender = row.barePeer.trim() === '' ? null : bareJid(row.barePeer);
    return (sender === null ? undefined : roomNames.get(sender)) ?? row.nick;
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
          // One batched name lookup for the batch's real room senders, like the
          // unread read does; the nick is never the stored sender.
          const roomNames =
            scope.kind === 'room'
              ? yield* Effect.promise(() =>
                  senderNamesByJid(
                    db,
                    rows.flatMap((row) => (row.barePeer.trim() === '' ? [] : [row.barePeer])),
                  ),
                )
              : new Map<string, string>();

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
                ${new Date(Number(atMicros / 1000n))}, ${senderFor(input, row, roomNames)}, ${text}, false
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
