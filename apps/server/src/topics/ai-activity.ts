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
import type { TurnStopper, TurnWatcher } from '../agents/gateway/stop-types';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { runSql } from '../effect/sql';
import type { TopicActivityEntry, TopicView } from './access';

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

// T-1514: the app's `getGateway` is typed as a `TurnStopper` (its stop-turn
// user); the live gateway also carries the `TurnWatcher` read model. Hand the
// gateway over as a watcher only when it has one, so a stop-only double reads
// as nobody working instead of throwing.
export function turnWatcherOf(gateway: TurnStopper | TurnWatcher | null): TurnWatcher | null {
  return gateway !== null && 'runningAiIds' in gateway ? gateway : null;
}

// T-1514: the topic list's AI activity. One `topicAiActivity` call covers the
// whole batch; one read then loads the names and one the pictures of every AI
// that appears. Best-effort like the read model: any failure leaves every
// view's `activity` empty rather than failing the list.
export interface TopicActivityDeps {
  db: ServerDatabase;
  /** Absent when the gateway is off; read as "no AI is working". */
  getGateway?: () => TurnWatcher | null;
}

export async function withTopicActivity(
  deps: TopicActivityDeps,
  views: TopicView[],
): Promise<TopicView[]> {
  if (views.length === 0) {
    return views;
  }
  try {
    const topics: AiActivityTopic[] = views.map((view) => ({
      topicId: view.id,
      groupId: view.groupId,
      roomJid: view.chatJid,
      isGeneral: view.isGeneral,
    }));
    const activity = await topicAiActivity(
      { db: deps.db, getGateway: deps.getGateway ?? (() => null) },
      topics,
    );
    const aiIds = [...new Set([...activity.values()].flat().map((entry) => entry.aiId))];
    const names = await aiNamesById(deps.db, aiIds);
    const avatars = await avatarIdsByOwner(deps.db, 'ai', aiIds);
    return views.map((view) => ({
      ...view,
      activity: activityEntries(activity.get(view.id) ?? [], names, avatars),
    }));
  } catch {
    return views.map((view) => ({ ...view, activity: [] }));
  }
}

const STATE_ORDER: Record<AiActivityState, number> = { working: 0, waiting: 1, done: 2 };

// The entries of one view, named by the AI rows and ordered working, then
// waiting, then done, then by name. An AI with no name row is left out.
function activityEntries(
  entries: TopicAiActivity[],
  names: Map<string, string>,
  avatars: Map<string, string>,
): TopicActivityEntry[] {
  const rows: TopicActivityEntry[] = [];
  for (const entry of entries) {
    const name = names.get(entry.aiId);
    if (name === undefined) {
      continue;
    }
    const avatarId = avatars.get(entry.aiId);
    rows.push({
      aiId: entry.aiId,
      name,
      ...(avatarId === undefined ? {} : { avatarUrl: avatarUrlFor(avatarId) }),
      state: entry.state,
    });
  }
  return rows.sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.name.localeCompare(right.name),
  );
}

// One read for the whole batch: the names of the AIs that appear in it.
async function aiNamesById(db: ServerDatabase, aiIds: string[]): Promise<Map<string, string>> {
  if (aiIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string }>`SELECT id, name FROM ais
        WHERE id IN ${sql.in(aiIds)}`;
    }),
  );
  return new Map(rows.map((row) => [row.id, row.name]));
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
