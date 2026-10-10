import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ExtractedMediaItem, MediaKind } from './indexer';

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

export { insertItems, toInsert };
