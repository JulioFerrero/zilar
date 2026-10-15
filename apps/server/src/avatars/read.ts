// effect-plain: moved unchanged from apps/server/src/avatars/service.ts (size split)
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
  // SEC-8 (T-1174): a group's picture is served to a member, and to anyone
  // when the group is public (Explore, search, the `/@handle` card); a private
  // group's non-member and an unknown id answer the same `null` (404).
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
