// The per-topic AI activity read model: for a batch of topics, each
// non-idle AI as `working` (a turn in flight), `waiting` (a pending approval
// or open question) or `done` (last card done), in that precedence. The
// whole batch costs three reads plus the gateway call. Every read is
// best-effort: a failure reads as empty.

import { Effect } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TurnStopper, TurnWatcher } from '../agents/gateway/stop-types';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { runSql } from '../effect/sql';
import { listOpenQuestionsForTopics, type OpenQuestionForActivity } from '../questions/service';
import type { TopicActivityEntry, TopicView } from './access';

export type AiActivityState = 'working' | 'waiting' | 'done';

export interface TopicAiActivity {
  aiId: string;
  state: AiActivityState;
  /** The newest open question card's message id, if any. */
  questionId?: string;
}

export interface AiActivityDeps {
  db: ServerDatabase;
  getGateway: () => TurnWatcher | null;
}

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
  const generalTopics = new Map<string, string>();
  for (const topic of topics) {
    if (topic.isGeneral) {
      generalTopics.set(topic.groupId, topic.topicId);
    }
  }

  const [pendingRows, cardRows, questionRows] = await Promise.all([
    loadPendingApprovals(deps.db, topicIds, [...generalTopics.keys()]),
    loadLastCardStates(deps.db, roomJids),
    loadOpenQuestions(deps.db, topicIds, [...generalTopics.keys()]),
  ]);

  const waiting = new Map<string, Set<string>>();
  for (const row of pendingRows) {
    const topicId =
      row.topicId ?? (row.groupId === null ? undefined : generalTopics.get(row.groupId));
    if (topicId !== undefined && activity.has(topicId)) {
      addTo(waiting, topicId, row.aiId);
    }
  }

  const questionByTopic = new Map<string, Map<string, string>>();
  for (const row of questionRows) {
    const topicId =
      row.topicId ?? (row.groupId === null ? undefined : generalTopics.get(row.groupId));
    if (topicId === undefined || !activity.has(topicId)) {
      continue;
    }
    addTo(waiting, topicId, row.aiId);
    const byAi = questionByTopic.get(topicId) ?? new Map<string, string>();
    if (!byAi.has(row.aiId)) {
      byAi.set(row.aiId, row.messageId);
    }
    questionByTopic.set(topicId, byAi);
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

  // Best-effort like the reads above: a throwing gateway must not reject the
  // answer and lose the waiting/done states; a failed scan reads as nobody
  // working.
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
    const questionByAi = questionByTopic.get(topic.topicId);
    activity.set(
      topic.topicId,
      [...states].map(([aiId, state]) => {
        const questionId = questionByAi?.get(aiId);
        return { aiId, state, ...(questionId === undefined ? {} : { questionId }) };
      }),
    );
  }
  return activity;
}

export function turnWatcherOf(gateway: TurnStopper | TurnWatcher | null): TurnWatcher | null {
  return gateway !== null && 'runningAiIds' in gateway ? gateway : null;
}

// The topic list's AI activity: one call covers the batch, then one read for
// names and one for pictures. Any failure leaves every view's `activity`
// empty rather than failing the list.
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

type ActivityEntry = TopicActivityEntry & { questionId?: string };

// The entries of one view, ordered working, waiting, done, then by name; an
// AI with no name row is left out.
function activityEntries(
  entries: TopicAiActivity[],
  names: Map<string, { name: string; jid: string }>,
  avatars: Map<string, string>,
): ActivityEntry[] {
  const rows: ActivityEntry[] = [];
  for (const entry of entries) {
    const ai = names.get(entry.aiId);
    if (ai === undefined) {
      continue;
    }
    const avatarId = avatars.get(entry.aiId);
    rows.push({
      aiId: entry.aiId,
      name: ai.name,
      jid: ai.jid,
      ...(avatarId === undefined ? {} : { avatarUrl: avatarUrlFor(avatarId) }),
      ...(entry.questionId === undefined ? {} : { questionId: entry.questionId }),
      state: entry.state,
    });
  }
  return rows.sort(
    (left, right) =>
      STATE_ORDER[left.state] - STATE_ORDER[right.state] || left.name.localeCompare(right.name),
  );
}

async function aiNamesById(
  db: ServerDatabase,
  aiIds: string[],
): Promise<Map<string, { name: string; jid: string }>> {
  if (aiIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string; jid: string }>`SELECT id, name, jid FROM ais
        WHERE id IN ${sql.in(aiIds)}`;
    }),
  );
  return new Map(rows.map((row) => [row.id, { name: row.name, jid: row.jid }]));
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
        // `sql.in([])` compiles to `IN ()`, which Postgres rejects, and the catch
        // would read it as no approvals; add the NULL-topic branch only when there
        // is a General group to attribute it to.
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

async function loadOpenQuestions(
  db: ServerDatabase,
  topicIds: string[],
  generalGroupIds: string[],
): Promise<readonly OpenQuestionForActivity[]> {
  try {
    return await listOpenQuestionsForTopics(db, topicIds, generalGroupIds);
  } catch {
    return [];
  }
}

interface LastCardRow {
  chatJid: string;
  aiId: string;
  stage: string | null;
}

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
