import type { ServerCore } from '../app/deps';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { type AuditRecorder } from '../audit/recorder';
import { extensionFor, resolveStorageDir } from '../stickers/storage';
import { type ServerDatabase } from '../db/client';
import { type AvatarOwnerKind } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { probeStickerBytes, type StickerImageInfo } from '../stickers/image';
export const AVATAR_MAX_BYTES = 256 * 1024;
const AVATAR_MIN_SIDE = 64;
const AVATAR_MAX_SIDE = 512;

type AvatarProbeError =
  | 'avatar_empty'
  | 'avatar_too_large'
  | 'avatar_not_image'
  | 'avatar_animated'
  | 'avatar_not_square'
  | 'avatar_bad_size';

interface AvatarCheck {
  info?: StickerImageInfo | undefined;
  error?: AvatarProbeError | undefined;
}

// At most 256 KB, a static WebP or PNG by magic bytes (never the content type or file
// name), square, with a side in [64, 512]. Animated images fail as `avatar_animated`;
// the huge-decoded-size case is enforced upstream by the shared sticker probe.
function checkAvatarBytes(bytes: Uint8Array): AvatarCheck {
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
  // The probe stays animation-neutral for stickers; only avatars reject animation, here.
  if (info.animated) {
    return { error: 'avatar_animated' };
  }
  if (info.width !== info.height) {
    return { error: 'avatar_not_square' };
  }
  // Order matters: the probe caps at 512 px, so a side past the avatar range surfaces
  // here as `avatar_bad_size`, and the square check comes first (1024x512 is "not
  // square", not "bad size").
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

export const avatarOwnerKindSchema = Schema.Literals(['user', 'ai', 'group']);
export type AvatarKind = typeof avatarOwnerKindSchema.Type;

export function avatarUrlFor(avatarId: string): string {
  return `/api/avatars/${encodeURIComponent(avatarId)}`;
}

export interface AvatarsServiceDeps extends Pick<ServerCore, 'db'> {
  storageDir: string;
  audit?: AuditRecorder;
}

// A person may change only their own picture; a group or channel only its owner or
// an admin; an AI only its owner. Anything else answers the same 404, so owner ids
// cannot be probed.
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

// The new file lands first, the row swaps in one statement (the unique index makes
// concurrent uploads end with exactly one row), then the old file is removed. A failure
// never leaves the owner without a picture.
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
    throw xmppUnavailable();
  }
  // Read the replaced row inside the same advisory-locked transaction that swaps it.
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
    throw xmppUnavailable();
  }
  if (oldStorageKey !== null && oldStorageKey !== storageKey) {
    // Best effort: the row already points at the new file, so a leftover file is an
    // orphan that is never served.
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

// Deletes the row and the file; idempotent. The permission check runs first, so
// strangers cannot probe whether a picture exists; the delete shares the owner's
// advisory lock with `uploadAvatar`, so a racing replace never removes the new row.
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
