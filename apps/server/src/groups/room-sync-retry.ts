import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import type { TopicRow } from '../topics/access';
import { syncTopicRoom, type TopicRoomDeps } from '../topics/rooms';

// T-1180 (SG-3): a group whose topic-room sync failed after a membership
// change is remembered here and retried every minute until every active topic
// room matches the database again. The sync is idempotent, so a retry is
// always safe. The map is in-memory: a restart drops the retry, and the next
// membership change of the group notes it again.
const RETRY_INTERVAL_MS = 60_000;

const pending = new Map<string, TopicRoomDeps>();
let retryTimer: NodeJS.Timeout | undefined;

// Remembers the group and starts the retry interval lazily on the first entry.
// `unref` keeps the timer from holding the process open on its own.
export function notePendingGroupSync(groupId: string, deps: TopicRoomDeps): void {
  pending.set(groupId, deps);
  if (retryTimer === undefined) {
    retryTimer = setInterval(() => {
      void drainPendingGroupSyncs();
    }, RETRY_INTERVAL_MS);
    retryTimer.unref();
  }
}

// One pass over every pending group. A group is dropped only when every one of
// its active topic rooms synced without error; until then it stays pending for
// the next pass. Exported for the test, and called by the interval above.
export async function drainPendingGroupSyncs(): Promise<void> {
  for (const [groupId, deps] of pending) {
    const synced = await syncPendingGroup(groupId, deps);
    if (synced) {
      pending.delete(groupId);
    }
  }
}

// Clears the retry interval on shutdown. `unref` already keeps the process
// from waiting on it, so wiring this into `main.ts` is optional.
export function stopRoomSyncRetry(): void {
  if (retryTimer !== undefined) {
    clearInterval(retryTimer);
    retryTimer = undefined;
  }
}

async function syncPendingGroup(groupId: string, deps: TopicRoomDeps): Promise<boolean> {
  let topics: TopicRow[];
  try {
    topics = await pendingGroupTopics(deps, groupId);
  } catch {
    deps.logger.warn({ groupId }, 'could not read the topics of a pending group');
    return false;
  }

  let synced = true;
  for (const topic of topics) {
    try {
      await syncTopicRoom(deps, topic);
    } catch {
      deps.logger.warn({ groupId }, 'could not retry a topic room sync');
      synced = false;
    }
  }
  return synced;
}

async function pendingGroupTopics(deps: TopicRoomDeps, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE group_id = ${groupId} AND archived_at IS NULL`;
    }),
  );
  return [...rows];
}
