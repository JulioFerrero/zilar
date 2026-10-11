import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

// The actor's membership row in one group, or `undefined` when they are not a
// member. A missing group and a non-member look the same here; each caller
// turns that into its own answer.
export async function findGroupMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' } | undefined> {
  const [membership] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' }>`
        SELECT group_id, user_id, role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return membership;
}

export function isGroupManagerRole(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

// Whether the user is an owner/admin of `groupId`. False for a non-member and
// for a plain member, and for a group that has no such row.
export async function isGroupManager(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const membership = await findGroupMembership(db, groupId, userId);
  return membership !== undefined && isGroupManagerRole(membership.role);
}
