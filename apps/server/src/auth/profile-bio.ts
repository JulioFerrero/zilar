// The bio lives in its own `user_profiles` table and never reaches a log.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export async function upsertProfileBio(
  db: ServerDatabase,
  userId: string,
  bio: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO user_profiles (user_id, bio, updated_at)
        VALUES (${userId}, ${bio}, now())
        ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, updated_at = now()`;
    }),
  );
}

// A LEFT JOIN, so a missing profile row means no bio.
export async function bioForUser(db: ServerDatabase, userId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ bio: string | null }>`SELECT p.bio
        FROM "user" u LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = ${userId} LIMIT 1`;
    }),
  );
  const bio = row?.bio ?? null;
  return bio === null || bio === '' ? null : bio;
}
