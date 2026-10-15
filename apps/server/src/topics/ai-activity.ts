// T-1505 (docs/audit/ai-work-plan.md §7 step 1): the per-topic AI activity read
// model. For a batch of topics it answers, per topic, each AI that is not idle:
// `working` when the gateway has a turn in flight in the topic's room,
// `waiting` when the AI has a live pending approval there, `done` when its last
// task card there finished `done`. Working wins over waiting, waiting over
// done. The whole batch costs two reads plus the gateway call — never one read
// per topic. Every read is best-effort: a failure reads as empty and never
// throws, so a chat list can always render.

import { Effect } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TurnWatcher } from '../agents/gateway/stop-types';
import { runSql } from '../effect/sql';

export type AiActivityState = 'working' | 'waiting' | 'done';

export interface TopicAiActivity {
  aiId: string;
  state: AiActivityState;
}

export interface AiActivityDeps {
  db: ServerDatabase;
  getGateway: () => TurnWatcher | null;
}

// One topic the caller asks about: its id and group, the room JID its turns
// carry, and whether it is the group's General topic (a room approval with a
// NULL `topic_id` counts for it).
export interface AiActivityTopic {
  topicId: string;
  groupId: string;
  roomJid: string;
  isGeneral: boolean;
}

export async function topicAiActivity(
  deps: AiActivityDeps,
  topics: ReadonlyArray<AiActivityTopic>,
): Promise<Map<string, TopicAiActivity[]>> {
  const activity = new Map<string, TopicAiActivity[]>();
  for (const topic of topics) {
    activity.set(topic.topicId, []);
  }
  if (topics.length === 0) {
    return activity;
  }

  const topicIds = topics.map((topic) => topic.topicId);
  const roomJids = [...new Set(topics.map((topic) => topic.roomJid))];
  // The gateway gives a group without a General topic row `topicId: ''`, so a
  // room approval can have `topic_id` NULL; it counts for the batch's General
  // topic of the same group.
  const generalTopics = new Map<string, string>();
  for (const topic of topics) {
    if (topic.isGeneral) {
      generalTopics.set(topic.groupId, topic.topicId);
    }
  }

  const [pendingRows, cardRows] = await Promise.all([
    loadPendingApprovals(deps.db, topicIds, [...generalTopics.keys()]),
    loadLastCardStates(deps.db, roomJids),
  ]);

  const waiting = new Map<string, Set<string>>();
  for (const row of pendingRows) {
    const topicId =
      row.topicId ?? (row.groupId === null ? undefined : generalTopics.get(row.groupId));
    if (topicId !== undefined && activity.has(topicId)) {
      addTo(waiting, topicId, row.aiId);
    }
  }

  const topicsByRoom = new Map<string, string[]>();
  for (const topic of topics) {
    const ids = topicsByRoom.get(topic.roomJid) ?? [];
    ids.push(topic.topicId);
    topicsByRoom.set(topic.roomJid, ids);
  }
  const done = new Map<string, Set<string>>();
  for (const row of cardRows) {
    if (row.stage !== 'card_done') {
      continue;
    }
    for (const topicId of topicsByRoom.get(row.chatJid) ?? []) {
      addTo(done, topicId, row.aiId);
    }
  }

  // Best-effort like the reads above: a throwing gateway (or getter) must not
  // reject the whole answer and lose the waiting/done states already gathered.
  // A failed scan reads as nobody working.
  const working = new Map<string, Set<string>>();
  try {
    const gateway = deps.getGateway();
    if (gateway !== null) {
      for (const topic of topics) {
        for (const aiId of gateway.runningAiIds(topic.roomJid)) {
          addTo(working, topic.topicId, aiId);
        }
      }
    }
  } catch {
    working.clear();
  }

  for (const topic of topics) {
    const states = new Map<string, AiActivityState>();
    for (const aiId of done.get(topic.topicId) ?? []) {
      states.set(aiId, 'done');
    }
    for (const aiId of waiting.get(topic.topicId) ?? []) {
      states.set(aiId, 'waiting');
    }
    for (const aiId of working.get(topic.topicId) ?? []) {
      states.set(aiId, 'working');
    }
    activity.set(
      topic.topicId,
      [...states].map(([aiId, state]) => ({ aiId, state })),
    );
  }
  return activity;
}

function addTo(index: Map<string, Set<string>>, key: string, value: string): void {
  const set = index.get(key) ?? new Set<string>();
  set.add(value);
  index.set(key, set);
}

interface PendingApprovalRow {
  topicId: string | null;
  groupId: string | null;
  aiId: string;
}

// One read for the whole batch: the still-pending, unexpired approvals in the
// batch's topics, plus the NULL-topic ones of the batch's General-topic groups.
async function loadPendingApprovals(
  db: ServerDatabase,
  topicIds: string[],
  generalGroupIds: string[],
): Promise<readonly PendingApprovalRow[]> {
  try {
    return await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // `sql.in([])` compiles to `IN ()`, which Postgres rejects, and the
        // `catch` below would swallow that as "no approvals": a batch without a
        // General topic would silently lose every `waiting` state. Only add the
        // NULL-topic branch when there is a General group to attribute it to.
        const scope: Array<Statement.Fragment> = [sql`topic_id IN ${sql.in(topicIds)}`];
        if (generalGroupIds.length > 0) {
          scope.push(sql`(topic_id IS NULL AND group_id IN ${sql.in(generalGroupIds)})`);
        }
        return yield* sql<PendingApprovalRow>`SELECT topic_id, group_id, ai_id FROM approvals
          WHERE status = 'pending' AND expires_at > now()
            AND ${sql.or(scope)}`;
      }),
    );
  } catch {
    return [];
  }
}

interface LastCardRow {
  chatJid: string;
  aiId: string;
  stage: string | null;
}

// One read for the whole batch: the latest `card_*` status row per
// (chat_jid, ai_id) in the batch's rooms. `DISTINCT ON (chat_jid, ai_id)
// … ORDER BY chat_jid, ai_id, at DESC` is served by
// `agent_task_events_status_idx`.
async function loadLastCardStates(
  db: ServerDatabase,
  roomJids: string[],
): Promise<readonly LastCardRow[]> {
  try {
    return await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<LastCardRow>`SELECT DISTINCT ON (chat_jid, ai_id)
            chat_jid, ai_id, data->>'stage' AS stage
          FROM agent_task_events
          WHERE kind = 'status' AND chat_jid IN ${sql.in(roomJids)}
            AND data->>'stage' LIKE 'card_%'
          ORDER BY chat_jid, ai_id, at DESC`;
      }),
    );
  } catch {
    return [];
  }
}
