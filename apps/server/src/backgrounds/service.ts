import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { chatBackgrounds } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { probeStickerBytes, type StickerImageInfo } from '../stickers/image';
import { resolveStorageDir } from '../stickers/service';

// Personal chat background wallpapers (T-0460). Unlike avatars, one upload is
// not a replacement: a user may keep up to `BACKGROUND_MAX_PER_USER` images,
// each a `randomUUID()` file on disk with `backgroundUrlFor` = `/api/backgrounds/<id>`.
// The bytes are readable by the owner only (the group-background read for
// members comes later, in task F).

export const BACKGROUND_MAX_BYTES = 1024 * 1024;
export const BACKGROUND_MAX_SIDE = 2048;
export const BACKGROUND_MIN_SIDE = 64;
export const BACKGROUND_MAX_PER_USER = 20;
export const BACKGROUND_UPLOAD_RATE_LIMIT_MAX = 20;
export const BACKGROUND_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// 2048 x 2048 x 4 is the largest decoded frame a wallpaper may claim.
const BACKGROUND_PROBE_LIMITS = {
  maxBytes: BACKGROUND_MAX_BYTES,
  maxDimension: BACKGROUND_MAX_SIDE,
  maxDecodedBytes: BACKGROUND_MAX_SIDE * BACKGROUND_MAX_SIDE * 4,
};

export type BackgroundRow = typeof chatBackgrounds.$inferSelect;

export interface BackgroundView {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

function extensionFor(mime: 'image/webp' | 'image/png'): string {
  return mime === 'image/webp' ? 'webp' : 'png';
}

export function backgroundUrlFor(backgroundId: string): string {
  return `/api/backgrounds/${encodeURIComponent(backgroundId)}`;
}

export interface BackgroundsServiceDeps {
  db: ServerDatabase;
  /** Directory background files are stored under; resolved once, absolutely. */
  storageDir: string;
}

export type BackgroundProbeError =
  | 'background_empty'
  | 'background_too_large'
  | 'background_not_image'
  | 'background_animated'
  | 'background_bad_size';

export interface BackgroundCheck {
  info?: StickerImageInfo | undefined;
  error?: BackgroundProbeError | undefined;
}

// Validates raw upload bytes: at most 1 MiB, a static WebP or PNG by magic
// bytes (never the client's content type or file name), with each side in
// [64, 2048]. The shared probe is given wallpaper limits (a 2048 px side and a
// 16 MiB decoded frame); anything it refuses that is not a size problem is a
// `background_not_image`. Side under 64 fails as `background_bad_size`.
export function checkBackgroundBytes(bytes: Uint8Array): BackgroundCheck {
  if (bytes.byteLength === 0) {
    return { error: 'background_empty' };
  }
  if (bytes.byteLength > BACKGROUND_MAX_BYTES) {
    return { error: 'background_too_large' };
  }
  const probed = probeStickerBytes(bytes, BACKGROUND_PROBE_LIMITS);
  if (!probed.ok) {
    // Too short, unknown magic, a truncated header, a side past 2048 or a
    // decode bomb: all "not a usable picture" for the upload route.
    return { error: 'background_not_image' };
  }
  const { info } = probed;
  if (info.animated) {
    return { error: 'background_animated' };
  }
  if (info.width < BACKGROUND_MIN_SIDE || info.height < BACKGROUND_MIN_SIDE) {
    return { error: 'background_bad_size' };
  }
  return { info };
}

function toBackgroundHttpError(check: BackgroundCheck): HttpError {
  switch (check.error) {
    case 'background_empty':
      return new HttpError(400, 'background_empty', 'The background file is empty');
    case 'background_too_large':
      return new HttpError(
        413,
        'background_too_large',
        'The background image is larger than 1 MiB',
      );
    case 'background_animated':
      return new HttpError(400, 'background_animated', 'The background must be a still image');
    case 'background_bad_size':
      return new HttpError(
        400,
        'background_bad_size',
        `The background must be between ${BACKGROUND_MIN_SIDE} and ${BACKGROUND_MAX_SIDE} pixels on each side`,
      );
    default:
      return new HttpError(400, 'background_not_image', 'The file is not a supported picture');
  }
}

export interface BackgroundUploadResult {
  id: string;
  url: string;
  width: number;
  height: number;
}

// Stores one new image: the per-user count is read and the row inserted under
// the user's advisory lock, so two concurrent uploads cannot both pass the cap
// (never check-then-insert). The file is written between the count and the
// insert; a failure after it lands removes it, so a refused upload leaves no
// orphan.
export async function uploadBackground(
  deps: BackgroundsServiceDeps,
  userId: string,
  bytes: Uint8Array,
): Promise<BackgroundUploadResult> {
  const check = checkBackgroundBytes(bytes);
  if (!check.info) {
    throw toBackgroundHttpError(check);
  }
  const info = check.info;
  const id = randomUUID();
  const storageKey = `${id}.${extensionFor(info.mime)}`;
  const storageDir = resolveStorageDir(deps.storageDir);
  let wroteFile = false;
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'background:' + userId}))`;
            const [total] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM chat_backgrounds WHERE user_id = ${userId}`;
            if (Number(total?.total ?? 0) >= BACKGROUND_MAX_PER_USER) {
              return yield* Effect.fail(
                new HttpError(409, 'too_many_backgrounds', 'Too many background images'),
              );
            }
            yield* Effect.promise(() => mkdir(storageDir, { recursive: true }));
            yield* Effect.promise(() => writeFile(join(storageDir, storageKey), bytes));
            wroteFile = true;
            yield* sql`INSERT INTO chat_backgrounds
                (id, user_id, mime, width, height, bytes, storage_key)
              VALUES (
                ${id}, ${userId}, ${info.mime}, ${info.width}, ${info.height},
                ${bytes.byteLength}, ${storageKey}
              )`;
          }),
        );
      }),
    );
  } catch (error) {
    if (wroteFile) {
      await rm(join(storageDir, storageKey), { force: true }).catch(() => {});
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return { id, url: backgroundUrlFor(id), width: info.width, height: info.height };
}

function toBackgroundView(row: BackgroundRow): BackgroundView {
  return {
    id: row.id,
    url: backgroundUrlFor(row.id),
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBackgrounds(
  db: ServerDatabase,
  userId: string,
): Promise<BackgroundView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundRow>`SELECT * FROM chat_backgrounds
        WHERE user_id = ${userId}
        ORDER BY created_at DESC, id DESC`;
    }),
  );
  return rows.map(toBackgroundView);
}

export interface BackgroundFile {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/png';
  size: number;
}

// An unknown id and another user's image answer the same `null`, so ids cannot
// be probed. T-0463: the image is also readable by a member of any group that
// uses it as its background. The path is built from the stored key only
// (`<uuid>.<ext>` written at upload), so a crafted id never touches the
// filesystem.
export async function readBackgroundFile(
  deps: BackgroundsServiceDeps,
  backgroundId: string,
  userId: string,
): Promise<BackgroundFile | null> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<BackgroundRow>`SELECT * FROM chat_backgrounds
        WHERE id = ${backgroundId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  if (row.userId !== userId) {
    const [membership] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ groupId: string }>`SELECT group_members.group_id
          FROM groups
          INNER JOIN group_members ON group_members.group_id = groups.id
          WHERE groups.background_image_id = ${backgroundId}
            AND group_members.user_id = ${userId}
          LIMIT 1`;
      }),
    );
    if (!membership) {
      return null;
    }
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  const filePath = join(storageDir, row.storageKey);
  if (dirname(filePath) !== storageDir) {
    return null;
  }
  try {
    const data = await readFile(filePath);
    return { bytes: new Uint8Array(data), mime: row.mime, size: row.bytes ?? data.byteLength };
  } catch {
    return null;
  }
}

// Deletes one image owned by the caller and clears every use of it, in one
// transaction: pref, default and group rows that referenced it drop the image
// id AND the dim (a dim without an image is invalid), rows that land back at
// all defaults are deleted, then the image row goes. An unknown or foreign id
// makes no change and returns false. The file is removed best-effort after
// the commit.
export async function deleteBackground(
  deps: BackgroundsServiceDeps,
  backgroundId: string,
  userId: string,
): Promise<boolean> {
  let storageKey: string | null = null;
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<{ storageKey: string }>`SELECT storage_key
            FROM chat_backgrounds
            WHERE id = ${backgroundId} AND user_id = ${userId} LIMIT 1`;
          if (row === undefined) {
            return;
          }
          storageKey = row.storageKey;
          yield* sql`UPDATE chat_prefs
            SET background_image_id = NULL, background_dim = NULL
            WHERE user_id = ${userId} AND background_image_id = ${backgroundId}`;
          yield* sql`UPDATE chat_background_defaults
            SET background_image_id = NULL, background_dim = NULL
            WHERE user_id = ${userId} AND background_image_id = ${backgroundId}`;
          // T-0463: a group that used this image loses it too, so members stop being
          // served a deleted image. Not scoped to the caller: the image may only be
          // referenced by a group they administer, and the FK would null it anyway.
          yield* sql`UPDATE groups
            SET background_image_id = NULL, background_dim = NULL
            WHERE background_image_id = ${backgroundId}`;
          yield* sql`DELETE FROM chat_prefs
            WHERE user_id = ${userId}
              AND muted_until IS NULL
              AND archived = false
              AND pinned_at IS NULL
              AND background_preset IS NULL
              AND background_image_id IS NULL
              AND background_dim IS NULL`;
          yield* sql`DELETE FROM chat_background_defaults
            WHERE user_id = ${userId}
              AND background_preset IS NULL
              AND background_image_id IS NULL
              AND background_dim IS NULL`;
          yield* sql`DELETE FROM chat_backgrounds
            WHERE id = ${backgroundId} AND user_id = ${userId}`;
        }),
      );
    }),
  );
  if (storageKey === null) {
    return false;
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  await rm(join(storageDir, storageKey), { force: true }).catch(() => {});
  return true;
}
