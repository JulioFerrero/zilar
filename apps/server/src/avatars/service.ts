import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { AvatarOwnerKind } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { resolveStorageDir } from '../stickers/service';
import { checkAvatarBytes, toAvatarHttpError } from './check';

// Profile pictures for people, AIs, groups and channels (T-0165): one row per
// owner (`owner_kind` + `owner_id` unique), a random `<uuid>.<ext>` on disk.
// Split (T-1553): the byte check lives in `./check`, the file read in `./read`;
// this path stays the barrel and re-exports every name it exported before.

export { AVATAR_MAX_BYTES, AVATAR_MIN_SIDE, AVATAR_MAX_SIDE, checkAvatarBytes } from './check';
export type { AvatarCheck, AvatarProbeError } from './check';
export { readAvatarFile } from './read';
export type { AvatarFile } from './read';

export const AVATAR_UPLOAD_RATE_LIMIT_MAX = 10;
export const AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// T-1174 (SEC-7): the read budget, charged per viewer inside `serve`.
export const AVATAR_READ_RATE_LIMIT_MAX = 600;
export const AVATAR_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const avatarOwnerKindSchema = Schema.Literals(['user', 'ai', 'group']);
export type AvatarKind = typeof avatarOwnerKindSchema.Type;

export type { AvatarRow } from '../db/rows';

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
    throw xmppUnavailable();
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
    throw xmppUnavailable();
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
// true }`). The permission check runs first, so strangers cannot probe whether
// a picture exists. The delete shares the owner's advisory lock with
// `uploadAvatar` and names the exact row read, so a racing replace removes the
// old row or nothing — never the new row.
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
