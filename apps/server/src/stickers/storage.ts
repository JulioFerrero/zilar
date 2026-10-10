import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { probeErrorCode, probeStickerBytes, STICKER_MAX_BYTES } from './image';
import type { StickerImageInfo } from './image';
import {
  emojiSchema,
  STICKERS_MAX_PER_PACK,
  type StickerPackRow,
  type StickerPackView,
  type StickerRow,
  type StickerView,
  type StickerVisibility,
  type StickersServiceDeps,
  type UploadStickerBody,
} from './schemas';

/**
 * Resolves the storage dir once (absolute, normalized), so path comparisons
 * below hold for relative configs like the default `./data/stickers`.
 *
 * Relative values resolve against the server package root (`apps/server`),
 * not the process cwd: the Dockerfile starts from `/app` while a developer
 * may start from the repo root, and both must land on the same directory.
 * Absolute values pass through unchanged. Documented in
 * `docs/SERVER_CONFIG.md` (Stickers).
 */
export function resolveStorageDir(dir: string, baseDir: string = SERVER_PACKAGE_ROOT): string {
  if (isAbsolute(dir)) {
    return resolve(dir);
  }
  return resolve(baseDir, dir);
}

/** The server package root (`apps/server`), the base for relative storage dirs. */
export function serverPackageRoot(from: string = fileURLToPath(import.meta.url)): string {
  // Walk up from the caller's file until the directory holding the
  // `package.json` named `@zilar/server`: relative storage dirs resolve
  // against the package root whatever the file's depth below it, and a
  // build step that changes the output shape (e.g. `src/` → `dist/`)
  // resolves to the same root instead of moving a directory up or down.
  // The walk stops at the filesystem root: without the package marker it
  // returns the root itself, so a misplaced file resolves against `/`.
  let directory = dirname(from);
  for (;;) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          (parsed as { name?: unknown }).name === '@zilar/server'
        ) {
          return directory;
        }
      } catch {
        // Not JSON (or unreadable): keep walking up, it is not our marker.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return directory;
    }
    directory = parent;
  }
}

export const SERVER_PACKAGE_ROOT: string = serverPackageRoot();

// A private pack the caller does not own is the same 404 as a missing id, so
// pack ids cannot be probed.
export async function requireVisiblePack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackRow> {
  const [pack] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  if (!pack) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  if (pack.visibility !== 'server' && pack.ownerId !== userId) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  return pack;
}

export async function requireOwnedPack(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
): Promise<StickerPackRow> {
  const [pack] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerPackRow>`SELECT * FROM sticker_packs WHERE id = ${packId} LIMIT 1`;
    }),
  );
  // Non-owners get the same 404 as a missing id (never 403), so private
  // pack ids cannot be probed — and a missing pack never leaks whether the
  // visibility would have allowed it.
  if (!pack || pack.ownerId !== userId) {
    throw new HttpError(404, 'not_found', 'Sticker pack not found');
  }
  return pack;
}

function stickerUrl(deps: StickersServiceDeps, stickerId: string): string {
  return `${deps.fileBasePath ?? '/api/stickers'}/${encodeURIComponent(stickerId)}/file`;
}

export function toStickerView(deps: StickersServiceDeps, row: StickerRow): StickerView {
  return {
    id: row.id,
    packId: row.packId,
    emoji: row.emoji,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    url: stickerUrl(deps, row.id),
  };
}

export function toPackView(
  deps: StickersServiceDeps,
  pack: StickerPackRow,
  rows: StickerRow[],
): StickerPackView {
  const ordered = [...rows].sort((left, right) => left.position - right.position);
  return {
    id: pack.id,
    ownerId: pack.ownerId,
    title: pack.title,
    visibility: pack.visibility as StickerVisibility,
    ...(pack.importedFrom === null || pack.importedFrom === ''
      ? {}
      : { importedFrom: pack.importedFrom }),
    stickers: ordered.map((row) => toStickerView(deps, row)),
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
  };
}

export function toAuditEntry(action: string, actorUserId: string, subjectId: string) {
  return {
    actorUserId,
    aiId: null as string | null,
    groupId: null as string | null,
    action,
    subjectId,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    detail: { packId: subjectId },
  };
}

function extensionFor(mime: 'image/webp' | 'image/png'): string {
  return mime === 'image/webp' ? 'webp' : 'png';
}

/** Escapes LIKE wildcards (`%`, `_`, `\`) in a user query fragment. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function uploadSticker(
  deps: StickersServiceDeps,
  packId: string,
  userId: string,
  bytes: Uint8Array,
  body: UploadStickerBody,
): Promise<StickerView> {
  await requireOwnedPack(deps, packId, userId);
  if (bytes.byteLength === 0) {
    throw new HttpError(400, 'sticker_empty', 'The sticker file is empty');
  }
  if (bytes.byteLength > STICKER_MAX_BYTES) {
    throw new HttpError(413, 'sticker_too_large', 'The sticker is larger than 512 KiB');
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    throw new HttpError(400, probeErrorCode(probed.error), 'The file is not a supported sticker');
  }
  const info: StickerImageInfo = probed.info;
  const emojiParsed = Schema.decodeUnknownOption(emojiSchema)(body.emoji);
  if (Option.isNone(emojiParsed)) {
    throw new HttpError(400, 'invalid_request', 'emoji must be at most 8 characters');
  }
  const id = randomUUID();
  const storageKey = `${id}.${extensionFor(info.mime)}`;
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
            yield* sql`INSERT INTO stickers
                (id, pack_id, position, emoji, mime, width, height, bytes, storage_key)
              VALUES (${id}, ${packId}, ${(top?.position ?? -1) + 1}, ${emojiParsed.value ?? null},
                ${info.mime}, ${info.width}, ${info.height}, ${bytes.byteLength}, ${storageKey})`;
            yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
              WHERE id = ${packId}`;
          }),
        );
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  try {
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, storageKey), bytes);
  } catch (error) {
    // The file never landed: remove the orphan metadata row so the sticker
    // does not 404 forever, then fail like any other write error.
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM stickers WHERE id = ${id}`;
      }),
    ).catch(() => {});
    throw error instanceof HttpError
      ? error
      : new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!row) {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return toStickerView(deps, row);
}

export async function deleteSticker(
  deps: StickersServiceDeps,
  packId: string,
  stickerId: string,
  userId: string,
): Promise<void> {
  await requireOwnedPack(deps, packId, userId);
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers
        WHERE id = ${stickerId} AND pack_id = ${packId} LIMIT 1`;
    }),
  );
  // A sticker id outside this pack (or a missing one) is the same 404, so
  // ids cannot be probed across packs.
  if (!row) {
    throw new HttpError(404, 'not_found', 'Sticker not found');
  }
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM stickers WHERE id = ${stickerId}`;
    }),
  );
  const { rm } = await import('node:fs/promises');
  const storageDir = resolveStorageDir(deps.storageDir);
  await rm(join(storageDir, row.storageKey), { force: true }).catch(() => {});
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE sticker_packs SET updated_at = ${new Date().toISOString()}
        WHERE id = ${packId}`;
    }),
  );
}

export interface StickerFile {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/png';
  size: number;
}

export async function readStickerFile(
  deps: StickersServiceDeps,
  stickerId: string,
): Promise<StickerFile | null> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<StickerRow>`SELECT * FROM stickers WHERE id = ${stickerId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  // The path is built from the stored key only (a `<uuid>.<ext>` written at
  // upload); the request id never touches the filesystem, so `..` or a
  // crafted name cannot escape the storage directory. Both sides are
  // resolved, so a relative `STICKER_STORAGE_DIR` (e.g. `./data/stickers`)
  // still compares equal to its own join.
  const storageDir = resolveStorageDir(deps.storageDir);
  const filePath = join(storageDir, row.storageKey);
  if (dirname(filePath) !== storageDir) {
    return null;
  }
  const { readFile } = await import('node:fs/promises');
  try {
    const data = await readFile(filePath);
    return { bytes: new Uint8Array(data), mime: row.mime, size: row.bytes };
  } catch {
    return null;
  }
}
