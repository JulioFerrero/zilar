import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { canSeeTopic, getTopic, type TopicRow } from '../topics/access';
import { getTool, getVersion, listRuns, listTools, listVersions, type PublicTool } from './service';

// Reader = the AI's owner who can see the topic, or a member of the
// topic. Manager = the AI's owner who can see the topic, or a group
// owner/admin who can see the topic. Returns null for a missing/deleted
// tool, a blind viewer, or a stranger (same shape for all, so existence
// is never leaked).
export async function toolAccess(
  db: ServerDatabase,
  toolId: string,
  userId: string,
): Promise<{ tool: NonNullable<Awaited<ReturnType<typeof getTool>>>; manager: boolean } | null> {
  const tool = await getTool(db, toolId);
  if (!tool) {
    return null;
  }
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${tool.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return null;
  }
  if (tool.topicId === null) {
    // Personal-chat tool: the AI owner only.
    return ai.owner === userId ? { tool, manager: true } : null;
  }
  const topic = await getTopic(db, tool.topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { tool, manager: true };
  }
  const membership = await findMembership(db, tool.groupId as string, userId);
  if (!membership) {
    return null;
  }
  return { tool, manager: membership.role === 'owner' || membership.role === 'admin' };
}

// Same manager check as `toolAccess`, but on the raw tool row — including
// soft-deleted ones. Only the DELETE route uses this (idempotent 204);
// every other route goes through `toolAccess`, so deleted tools still
// read as missing everywhere else.
export async function toolAccessIncludingDeleted(
  db: ServerDatabase,
  toolId: string,
  userId: string,
): Promise<{
  tool: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    name: string;
    currentVersion: number;
  };
  manager: boolean;
} | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        aiId: string;
        groupId: string | null;
        topicId: string | null;
        name: string;
        currentVersion: number;
      }>`SELECT ai_id, group_id, topic_id, name, current_version FROM ai_tools
        WHERE id = ${toolId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return null;
  }
  if (row.topicId === null) {
    return ai.owner === userId ? { tool: row, manager: true } : null;
  }
  const topic = await getTopic(db, row.topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { tool: row, manager: true };
  }
  if (row.groupId === null) {
    return null;
  }
  const membership = await findMembership(db, row.groupId, userId);
  if (!membership) {
    return null;
  }
  return { tool: row, manager: membership.role === 'owner' || membership.role === 'admin' };
}

export async function requireReadableTool(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return access.tool;
}

export async function requireReadableVersions(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const versions = await listVersions(db, toolId);
  if (!versions) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return versions;
}

export async function requireReadableVersion(
  db: ServerDatabase,
  toolId: string,
  versionParam: string,
  userId: string,
) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const parsed = Number.parseInt(versionParam, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(404, 'not_found', 'Tool version not found');
  }
  const version = await getVersion(db, toolId, parsed);
  if (!version) {
    throw new HttpError(404, 'not_found', 'Tool version not found');
  }
  return version;
}

export async function requireReadableRuns(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const runs = await listRuns(db, toolId, 20);
  if (!runs) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return runs;
}

// All non-deleted tools of every AI attached to a group, each with its
// scope — but only in topics the viewer can see. The caller is a member
// (checked by the route); the helper additionally gates each topic.
export async function listToolsForGroup(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<Array<PublicTool & { scope: 'personal' | 'group' }>> {
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
  for (const topic of topicRows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    if (!(await canSeeTopic(db, topic, userId))) {
      continue;
    }
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
          WHERE group_id = ${groupId}`;
      }),
    );
    const topicAiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
          WHERE topic_id = ${topic.id}`;
      }),
    );
    const aiIds = new Set([
      ...aiRows.map((row) => row.aiId),
      ...topicAiRows.map((row) => row.aiId),
    ]);
    for (const aiId of aiIds) {
      const tools = await listTools(db, { aiId, groupId, topicId: topic.id });
      for (const tool of tools) {
        result.push({ ...tool, scope: 'group' as const });
      }
    }
  }
  return result;
}

export async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais
        WHERE id = ${aiId} AND owner = ${ownerId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: 'owner' | 'admin' | 'member' }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}
