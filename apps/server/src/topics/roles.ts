import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpError } from '../errors';
import { runSql } from '../effect/sql';
import { emitTopicAi } from '../groups/events';
import {
  aiMayBeInTopic,
  getTopic,
  requireManagedTopic,
  toMissingTopic,
  type TopicRow,
} from './access';
import { syncTopicRoom } from './rooms';
import { toAuditEntry, type TopicServiceDeps } from './schemas';

// Compares the topic's `topic_ais` rows against the live rule
// (`aiMayBeInTopic`) and emits `ai-removed` for every AI that just dropped
// out of the room. The sync above already removed their affiliations; this
// tells live gateway sessions to leave right away instead of waiting for
// the next reconcile.
export async function emitDroppedTopicAis(deps: TopicServiceDeps, topic: TopicRow): Promise<void> {
  if (topic.isGeneral || topic.archivedAt !== null) {
    return;
  }
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string; owner: string; status: string }>`
        SELECT topic_ais.ai_id, ais.owner, ais.status
        FROM topic_ais
        INNER JOIN ais ON ais.id = topic_ais.ai_id
        WHERE topic_ais.topic_id = ${topic.id}`;
    }),
  );
  for (const row of rows) {
    const allowed = await aiMayBeInTopic(deps.db, topic, {
      id: row.aiId,
      owner: row.owner,
      status: row.status,
    });
    if (!allowed) {
      emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId: row.aiId });
    }
  }
}

export interface AddTopicAiBody {
  aiId: string;
}

// T-0116: attach roles to a topic and pick its approver role. The actor
// must be a topic manager (creator or group owner/admin) who can see the
// topic — the same rule as every other `PUT` here. Only roles of the
// topic's group count, and only for private topics: roles are meaningless
// on a public one, like `memberIds`. The approver role may be null
// ("Owner and admins only"). The room re-syncs so new holders join and
// removed holders leave.
export interface SetTopicRolesBody {
  roleIds: string[];
  approverRoleId: string | null;
}

export interface SetTopicRolesInput extends SetTopicRolesBody {
  topicId: string;
  actorId: string;
}

export async function setTopicRoles(
  deps: TopicServiceDeps,
  input: SetTopicRolesInput,
): Promise<TopicRow> {
  const topic = await requireManagedTopic(deps.db, input.topicId, input.actorId);
  if (topic.visibility !== 'private') {
    throw new HttpError(400, 'not_private', 'Only private topics have roles');
  }
  if (topic.isGeneral) {
    throw new HttpError(400, 'not_private', 'The General topic is public');
  }
  const roles = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`
        SELECT * FROM group_roles WHERE group_id = ${topic.groupId}`;
    }),
  );
  const byId = new Map(roles.map((role) => [role.id, role]));
  const wanted = [...new Set(input.roleIds)];
  if (wanted.some((id) => !byId.has(id))) {
    throw new HttpError(400, 'invalid_request', 'Roles must belong to the topic’s group');
  }
  if (input.approverRoleId !== null && !byId.has(input.approverRoleId)) {
    throw new HttpError(
      400,
      'invalid_request',
      'The approver role must belong to the topic’s group',
    );
  }
  const wantedIds = new Set(wanted);
  // One transaction under the group's advisory lock, reading the current
  // set INSIDE it: two concurrent PUTs serialize and the second diffs
  // against the first's commit (last-writer-wins, like `setRoleMembers`).
  // The approver update rides the same transaction so access and approver
  // can never disagree.
  const approverChanged = (topic.approverRoleId ?? null) !== input.approverRoleId;
  const diff = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${topic.groupId}))`;
          const rows = yield* sql<{ roleId: string }>`
            SELECT role_id FROM topic_role_access WHERE topic_id = ${topic.id}`;
          const liveIds = new Set(rows.map((row) => row.roleId));
          const nextAdded = wanted.filter((id) => !liveIds.has(id));
          const nextRemoved = [...liveIds].filter((id) => !wantedIds.has(id));
          if (nextAdded.length > 0) {
            yield* sql`INSERT INTO topic_role_access ${sql.insert(
              nextAdded.map((roleId) => ({ topic_id: topic.id, role_id: roleId })),
            )} ON CONFLICT DO NOTHING`;
          }
          if (nextRemoved.length > 0) {
            yield* sql`DELETE FROM topic_role_access
              WHERE topic_id = ${topic.id} AND role_id IN ${sql.in(nextRemoved)}`;
          }
          if (approverChanged) {
            yield* sql`UPDATE topics
              SET approver_role_id = ${input.approverRoleId}, updated_at = now()
              WHERE id = ${topic.id}`;
          }
          return { added: nextAdded, removed: nextRemoved };
        }),
      );
    }),
  );
  const { added, removed } = diff;
  const updated = await getTopic(deps.db, topic.id);
  if (!updated) {
    throw toMissingTopic();
  }
  // The audit block runs even when the room sync below fails: the database
  // already committed, so the change is real and the log must say so. The
  // caller still sees the 502 and the room heals on the next write.
  if (deps.audit) {
    for (const roleId of added) {
      await deps.audit.record(toAuditEntry(updated, 'topic.role_added', input.actorId, { roleId }));
    }
    for (const roleId of removed) {
      await deps.audit.record(
        toAuditEntry(updated, 'topic.role_removed', input.actorId, { roleId }),
      );
    }
    if (approverChanged) {
      await deps.audit.record(
        toAuditEntry(
          updated,
          'topic.approver_role_set',
          input.actorId,
          input.approverRoleId === null ? {} : { roleId: input.approverRoleId },
        ),
      );
    }
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return updated;
}
