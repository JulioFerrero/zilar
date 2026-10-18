import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { HttpError } from '../errors';

// T-1991: a role is a way into every private topic that lists it, so a
// group manager who cannot see one of those topics must not be able to hand
// the role to anyone — themselves included. The user guide promises that a
// group owner or admin who is not in a private topic cannot see it.
export const PRIVATE_TOPIC_GRANT_MESSAGE =
  "You can't add people to a role that opens a private topic you're not in";

// Runs on the caller's transaction client, so the refusal and the insert
// share one statement stream and a refusal writes nothing. The visibility
// expression mirrors `canSeeTopic` for private topics: a group member who is
// a direct topic member or holds one of the topic's roles.
export function assertRoleGrantAllowed(
  sql: SqlClient.SqlClient,
  roleId: string,
  actorId: string,
  addedUserIds: string[],
): Effect.Effect<void, HttpError | SqlError.SqlError> {
  if (addedUserIds.length === 0) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const rows = yield* sql<{ id: string }>`SELECT topics.id FROM topics
      INNER JOIN topic_role_access ON topic_role_access.topic_id = topics.id
      WHERE topic_role_access.role_id = ${roleId}
        AND topics.visibility = 'private'
        AND topics.archived_at IS NULL
        AND NOT (
          EXISTS (SELECT 1 FROM group_members
            WHERE group_members.group_id = topics.group_id
              AND group_members.user_id = ${actorId})
          AND (
            EXISTS (SELECT 1 FROM topic_members
              WHERE topic_members.topic_id = topics.id
                AND topic_members.user_id = ${actorId})
            OR EXISTS (
              SELECT 1 FROM topic_role_access AS shared
              INNER JOIN group_member_roles ON group_member_roles.role_id = shared.role_id
              WHERE shared.topic_id = topics.id
                AND group_member_roles.user_id = ${actorId}
            )
          )
        )
      LIMIT 1`;
    if (rows.length > 0) {
      return yield* Effect.fail(new HttpError(403, 'forbidden', PRIVATE_TOPIC_GRANT_MESSAGE));
    }
  });
}
