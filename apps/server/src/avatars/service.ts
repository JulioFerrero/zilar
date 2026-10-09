import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { AvatarOwnerKind, AvatarRow } from '../db/rows';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { probeStickerBytes, type StickerImageInfo } from '../stickers/image';
import { resolveStorageDir } from '../stickers/service';

// Profile pictures for people, AIs, groups and channels (T-0165). The
// browser crops and resizes; the server only validates and stores — one
// row per owner (`owner_kind` + `owner_id` is unique), a random
// `<uuid>.<ext>` file on disk, `avatarUrl` = `/api/avatars/<id>`.

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_MIN_SIDE = 64;
export const AVATAR_MAX_SIDE = 512;
export const AVATAR_UPLOAD_RATE_LIMIT_MAX = 10;
export const AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export const avatarOwnerKindSchema = Schema.Literals(['user', 'ai', 'group']);
export type AvatarKind = typeof avatarOwnerKindSchema.Type;

export type { AvatarRow };

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

export function avatarUrlFor(avatarId: string): string {
  return `/api/avatars/${encodeURIComponent(avatarId)}`;
}

export interface AvatarsServiceDeps {
  db: ServerDatabase;
  /** Directory avatar files are stored under; resolved once, absolutely. */
  storageDir: string;
  audit?: AuditRecorder;
}

export type AvatarProbeError =
  | 'avatar_empty'
  | 'avatar_too_large'
  | 'avatar_not_image'
  | 'avatar_animated'
  | 'avatar_not_square'
  | 'avatar_bad_size';

export interface AvatarCheck {
  info?: StickerImageInfo | undefined;
  error?: AvatarProbeError | undefined;
}

// Validates raw upload bytes: at most 256 KB, a static WebP or PNG by
// magic bytes (never the client's content type or file name), square, with
// a side in [64, 512]. Static-only: an animated WebP or APNG fails as
// `avatar_animated`, not as "not an image". The huge-decoded-size case
// ("claims a huge decoded size") is enforced upstream by the shared sticker
// probe (`too_large`/`decode_too_large` map to `avatar_not_image` below);
// past the square and 64..512 checks no further bomb check can fire
// (512 x 512 x 4 is 1 MiB, under the shared 4 MiB limit).
export function checkAvatarBytes(bytes: Uint8Array): AvatarCheck {
  if (bytes.byteLength === 0) {
    return { error: 'avatar_empty' };
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { error: 'avatar_too_large' };
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    return { error: 'avatar_not_image' };
  }
  const { info } = probed;
  // The probe stays animation-neutral for stickers (T-0120 accepts animated
  // WebP/APNG); only avatars reject animated images, checked here.
  if (info.animated) {
    return { error: 'avatar_animated' };
  }
  if (info.width !== info.height) {
    return { error: 'avatar_not_square' };
  }
  // The order matters: the shared sticker probe caps at 512 px, so a side
  // past the avatar range surfaces here as `avatar_bad_size` — except a
  // side past 512, which the probe already refused as `too_large` (mapped
  // to `avatar_not_image` above). Keep the square check first (a 1024x512
  // file is "not square", not "bad size").
  if (info.width < AVATAR_MIN_SIDE || info.width > AVATAR_MAX_SIDE) {
    return { error: 'avatar_bad_size' };
  }
  return { info };
}

function toAvatarHttpError(check: AvatarCheck): HttpError {
  switch (check.error) {
    case 'avatar_empty':
      return new HttpError(400, 'avatar_empty', 'The picture file is empty');
    case 'avatar_too_large':
      return new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
    case 'avatar_animated':
      return new HttpError(400, 'avatar_animated', 'The picture must be a still image');
    case 'avatar_not_square':
      return new HttpError(400, 'avatar_not_square', 'The picture must be square');
    case 'avatar_bad_size':
      return new HttpError(
        400,
        'avatar_bad_size',
        `The picture must be between ${AVATAR_MIN_SIDE} and ${AVATAR_MAX_SIDE} pixels on each side`,
      );
    default:
      return new HttpError(400, 'avatar_not_image', 'The file is not a supported picture');
  }
}

// Who may change which picture. A person only their own; a group or
// channel only its owner or an admin; an AI only the person who owns it
// (`ais.owner`, the same ownership the AI routes check). Anything else —
// an unknown owner, a wrong kind, a stranger — answers the same 404, so
// owner ids cannot be probed through this route.
export async function checkAvatarWritePermission(
  db: ServerDatabase,
  kind: AvatarKind,
  ownerId: string,
  userId: string,
): Promise<void> {
  if (kind === 'user') {
    if (ownerId !== userId) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`SELECT id FROM "user" WHERE id = ${ownerId} LIMIT 1`;
      }),
    );
    if (!row) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    return;
  }
  if (kind === 'group') {
    const [membership] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ role: string }>`SELECT role FROM group_members
          WHERE group_id = ${ownerId} AND user_id = ${userId} LIMIT 1`;
      }),
    );
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new HttpError(404, 'not_found', 'Avatar not found');
    }
    return;
  }
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${ownerId} LIMIT 1`;
    }),
  );
  if (!ai || ai.owner !== userId) {
    throw new HttpError(404, 'not_found', 'Avatar not found');
  }
}

export interface AvatarUploadResult {
  url: string;
}

// Replaces the owner's picture: the new file lands first, the row swaps
// in one statement (the unique index makes concurrent uploads end with
// exactly one row), then the old file is removed. A failure never leaves
// the owner without a picture — even when the old file cannot be
// removed, its row is already gone and the new picture serves.
export async function uploadAvatar(
  deps: AvatarsServiceDeps,
  kind: AvatarKind,
  ownerId: string,
  userId: string,
  bytes: Uint8Array,
): Promise<AvatarUploadResult> {
  await checkAvatarWritePermission(deps.db, kind, ownerId, userId);
  const check = checkAvatarBytes(bytes);
  if (!check.info) {
    throw toAvatarHttpError(check);
  }
  const info = check.info;
  const id = randomUUID();
  const storageKey = `${id}.${extensionFor(info.mime)}`;
  const storageDir = resolveStorageDir(deps.storageDir);
  try {
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, storageKey), bytes);
  } catch {
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  // Read the replaced row inside the same advisory-locked transaction that
  // swaps it, so the old file removed below is exactly the replaced one.
  let oldStorageKey: string | null = null;
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'avatar:' + kind + ':' + ownerId}))`;
            const [previous] = yield* sql<{ storageKey: string }>`SELECT storage_key FROM avatars
              WHERE owner_kind = ${kind} AND owner_id = ${ownerId} LIMIT 1`;
            oldStorageKey = previous?.storageKey ?? null;
            yield* sql`INSERT INTO avatars
                (id, owner_kind, owner_id, mime, width, height, bytes, storage_key)
              VALUES (
                ${id}, ${kind}, ${ownerId}, ${info.mime}, ${info.width}, ${info.height},
                ${bytes.byteLength}, ${storageKey}
              )
              ON CONFLICT (owner_kind, owner_id) DO UPDATE SET
                id = ${id},
                mime = ${info.mime},
                width = ${info.width},
                height = ${info.height},
                bytes = ${bytes.byteLength},
                storage_key = ${storageKey},
                created_at = ${new Date().toISOString()}`;
          }),
        );
      }),
    );
  } catch (error) {
    await rm(join(storageDir, storageKey), { force: true }).catch(() => {});
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (oldStorageKey !== null && oldStorageKey !== storageKey) {
    // Best effort: the row already points at the new file, so a leftover
    // old file is an orphan that is never served — never a missing picture.
    await rm(join(storageDir, oldStorageKey), { force: true }).catch(() => {});
  }
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: kind === 'ai' ? ownerId : null,
      groupId: kind === 'group' ? ownerId : null,
      action: 'avatar.updated',
      subjectId: ownerId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { ownerKind: kind, ownerId },
    });
  }
  return { url: avatarUrlFor(id) };
}

// Removes the row and the file; idempotent (a missing picture is `{ ok:
// true }`). The permission check runs first, so strangers cannot probe
// whether a picture exists. The read and the delete share the owner's
// advisory lock (the same lock `uploadAvatar` holds) and the delete names
// the exact row that was read (`ownerKind`, `ownerId`, `storageKey`), so a
// delete racing a replace removes either the old row with its old file or
// nothing at all — never the new row while deleting the old file.
export async function deleteAvatar(
  deps: AvatarsServiceDeps,
  kind: AvatarKind,
  ownerId: string,
  userId: string,
): Promise<void> {
  await checkAvatarWritePermission(deps.db, kind, ownerId, userId);
  let storageKey: string | null = null;
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'avatar:' + kind + ':' + ownerId}))`;
          const [row] = yield* sql<{ storageKey: string }>`SELECT storage_key FROM avatars
            WHERE owner_kind = ${kind} AND owner_id = ${ownerId} LIMIT 1`;
          if (row === undefined) {
            return;
          }
          storageKey = row.storageKey;
          yield* sql`DELETE FROM avatars
            WHERE owner_kind = ${kind} AND owner_id = ${ownerId} AND storage_key = ${row.storageKey}`;
        }),
      );
    }),
  );
  if (storageKey === null) {
    return;
  }
  const storageDir = resolveStorageDir(deps.storageDir);
  await rm(join(storageDir, storageKey), { force: true }).catch(() => {});
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: kind === 'ai' ? ownerId : null,
      groupId: kind === 'group' ? ownerId : null,
      action: 'avatar.removed',
      subjectId: ownerId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { ownerKind: kind, ownerId },
    });
  }
}

export interface AvatarFile {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/png';
  size: number;
}

export async function readAvatarFile(
  deps: AvatarsServiceDeps,
  avatarId: string,
): Promise<AvatarFile | null> {
  const [row] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AvatarRow>`SELECT * FROM avatars WHERE id = ${avatarId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  // The path is built from the stored key only (a `<uuid>.<ext>` written at
  // upload); the request id never touches the filesystem, so `..` or a
  // crafted name cannot escape the storage directory. Both sides are
  // resolved, so a relative `AVATAR_STORAGE_DIR` still compares equal to
  // its own join.
  const storageDir = resolveStorageDir(deps.storageDir);
  const filePath = join(storageDir, row.storageKey);
  if (dirname(filePath) !== storageDir) {
    return null;
  }
  const { readFile } = await import('node:fs/promises');
  try {
    const data = await readFile(filePath);
    return { bytes: new Uint8Array(data), mime: row.mime, size: row.bytes ?? data.byteLength };
  } catch {
    return null;
  }
}

// The avatar ids of a set of owners, in one query per kind — the read
// path that every list route uses to attach `avatarUrl` at read time.
export async function avatarIdsByOwner(
  db: ServerDatabase,
  kind: AvatarOwnerKind,
  ownerIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ownerIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; ownerId: string }>`SELECT id, owner_id
        FROM avatars
        WHERE owner_kind = ${kind} AND owner_id IN ${sql.in(unique)}`;
    }),
  );
  return new Map(rows.map((row) => [row.ownerId, row.id]));
}
