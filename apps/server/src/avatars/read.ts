// effect-plain: avatar file reads are plain fs calls; no Effect in this module.
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AvatarRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { resolveStorageDir } from '../stickers/service';
import type { AvatarsServiceDeps } from './service';

export interface AvatarFile {
  bytes: Uint8Array;
  mime: 'image/webp' | 'image/png';
  size: number;
}

export async function readStoredFile(
  storageDir: string,
  storageKey: string,
): Promise<Uint8Array | null> {
  // The path is built from the stored key only (`<uuid>.<ext>` written at upload), so a
  // request id can never escape the storage directory, even with `..`.
  const dir = resolveStorageDir(storageDir);
  const filePath = join(dir, storageKey);
  if (dirname(filePath) !== dir) return null;
  const { readFile } = await import('node:fs/promises');
  try {
    return new Uint8Array(await readFile(filePath));
  } catch {
    return null;
  }
}

export async function readAvatarFile(
  deps: AvatarsServiceDeps,
  avatarId: string,
  userId: string,
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
  // SEC-8: a group's picture is served to a member, and to anyone when the group is
  // public; a private group's non-member and an unknown id answer the same `null`.
  if (row.ownerKind === 'group') {
    const [group] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ visibility: 'private' | 'public'; memberId: string | null }>`SELECT
            groups.visibility,
            group_members.user_id AS "memberId"
          FROM groups
          LEFT JOIN group_members
            ON group_members.group_id = groups.id AND group_members.user_id = ${userId}
          WHERE groups.id = ${row.ownerId} LIMIT 1`;
      }),
    );
    if (!group || (group.visibility !== 'public' && group.memberId === null)) {
      return null;
    }
  }
  const bytes = await readStoredFile(deps.storageDir, row.storageKey);
  if (!bytes) return null;
  return { bytes, mime: row.mime, size: row.bytes ?? bytes.byteLength };
}
