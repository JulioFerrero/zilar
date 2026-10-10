// T-1028: size split of `routines/execute.ts`. The ordered preflight checks —
// the AI/room membership, the tool's current hosts and the approved-host
// subset — live here; the old path stays the barrel.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import type { TopicRow } from '../topics/access';
import { allowedTopicAiIds } from '../topics/access';
import { runSql } from '../effect/sql';

interface ToolVersionHostsRow {
  hosts: string[];
}

interface GroupAiRow {
  aiId: string;
}

type TopicRoomRow = Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>;

// Whether the AI is still a member of the routine topic's room: General
// topics read `group_ais`; other topics use the derived rule of
// `allowedTopicAiIds` (the AI is in `topic_ais` and, in a private topic, its
// owner still sees the topic), so the tool never runs for an AI that may no
// longer be there. An archived topic's room is gone, so the routine skips.
export async function isAiInTopicRoom(db: ServerDatabase, row: RoutineRow): Promise<boolean> {
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRoomRow>`SELECT id, group_id, visibility, is_general, archived_at
        FROM topics
        WHERE id = ${row.topicId as string}
        LIMIT 1`;
    }),
  );
  if (!topic || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    const [match] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<GroupAiRow>`SELECT ai_id FROM group_ais
          WHERE group_id = ${row.groupId as string} AND ai_id = ${row.aiId}
          LIMIT 1`;
      }),
    );
    return match !== undefined;
  }
  return (await allowedTopicAiIds(db, topic)).has(row.aiId);
}

export async function readCurrentHosts(
  db: ServerDatabase,
  toolId: string,
  currentVersion: number,
): Promise<string[] | null> {
  const [version] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolVersionHostsRow>`SELECT hosts FROM ai_tool_versions
        WHERE tool_id = ${toolId} AND version = ${currentVersion}
        LIMIT 1`;
    }),
  );
  return version ? [...version.hosts] : null;
}

export function isSubset(current: readonly string[], approved: readonly string[]): boolean {
  const allowed = new Set(approved);
  return current.every((host) => allowed.has(host));
}
