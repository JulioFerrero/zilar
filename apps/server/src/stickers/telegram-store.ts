import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { STICKERS_MAX_PER_PACK } from '@zilar/api-contract';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { convertibleKind, defaultConverter } from './convert';
import { probeStickerBytes, STICKER_MAX_BYTES, type StickerImageInfo } from './image';
import { emojiSchema, type StickerRow, type StickersServiceDeps } from './schemas';
import { resolveStorageDir } from './storage';

// Validates (the same magic-byte probe as uploads) and stores one imported
// sticker. A moving file (a video `.webm`) is converted to an animated WebP
// first, exactly like an upload (T-1496); a conversion failure counts as
// invalid. A file that fails validation is skipped, never stored; a
// concurrent duplicate insert wins nothing (`onConflictDoNothing` on the
// per-pack `source_id` index) writes no file and is not counted, like a
// sticker already in the pack; a full pack reports
// `pack_full` so the caller ends the import with a summary instead of a 400
// (a double-submitted import races safely through the same path).
export async function storeImportedSticker(
  deps: StickersServiceDeps,
  packId: string,
  item: { sourceId: string; fileId: string; emoji: string | null },
  bytes: Uint8Array,
): Promise<'stored' | 'skipped' | 'duplicate' | 'pack_full'> {
  if (bytes.byteLength === 0) {
    return 'skipped';
  }
  // Convert a moving sticker before the size check and the probe, so a
  // converted video goes through the still path. Any failure is a skip, never
  // a failed import.
  const kind = convertibleKind(bytes);
  if (kind !== null) {
    try {
      bytes = await (deps.converter ?? defaultConverter).toAnimatedWebp(bytes, kind);
    } catch {
      return 'skipped';
    }
  }
  if (bytes.byteLength > STICKER_MAX_BYTES) {
    return 'skipped';
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    return 'skipped';
  }
  const info: StickerImageInfo = probed.info;
  const emojiParsed = Schema.decodeUnknownOption(emojiSchema)(item.emoji ?? undefined);
  const emoji = Option.isNone(emojiParsed) ? null : (emojiParsed.value ?? null);
  const id = randomUUID();
  const extension = info.mime === 'image/webp' ? 'webp' : 'png';
  const storageKey = `${id}.${extension}`;
  let inserted = false;
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${packId}))`;
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM stickers WHERE pack_id = ${packId}`;
            if (Number(counter?.total ?? 0) >= STICKERS_MAX_PER_PACK) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'pack_full',
                  `A pack holds at most ${STICKERS_MAX_PER_PACK} stickers`,
                ),
              );
            }
            const [top] = yield* sql<{ position: number }>`SELECT position FROM stickers
              WHERE pack_id = ${packId}
              ORDER BY position DESC LIMIT 1`;
            const stored = yield* sql<{ id: string }>`INSERT INTO stickers
                (id, pack_id, position, emoji, mime, width, height, bytes, storage_key, source_id)
              VALUES (${id}, ${packId}, ${(top?.position ?? -1) + 1}, ${emoji}, ${info.mime},
                ${info.width}, ${info.height}, ${bytes.byteLength}, ${storageKey}, ${item.sourceId})
              ON CONFLICT DO NOTHING RETURNING id`;
            inserted = stored.length > 0;
            yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
              WHERE id = ${packId}`;
          }),
        );
      }),
    );
  } catch (error) {
    // `pack_full` is a graceful outcome, not a request failure: the batch
    // loop stops queuing and the import answers with its summary.
    if (error instanceof HttpError && error.code === 'pack_full') {
      return 'pack_full';
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw xmppUnavailable();
  }
  if (!inserted) {
    return 'duplicate';
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  try {
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, storageKey), bytes);
  } catch {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM stickers WHERE id = ${id}`;
      }),
    ).catch(() => {});
    return 'skipped';
  }
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${id} LIMIT 1`;
    }),
  );
  return row ? 'stored' : 'skipped';
}
