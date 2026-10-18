import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import type { TopicRow } from '../topics/access';
import { syncTopicRoom, type TopicRoomDeps } from '../topics/rooms';

// A group whose topic-room sync failed is retried every minute until the
// rooms match the database again, archived rooms included, so a failed
// removal leaves nothing stale. Idempotent, in-memory: a restart drops the
// retry and the next membership change notes the group again.
const RETRY_INTERVAL_MS = 60_000;

const pending = new Map<string, TopicRoomDeps>();
let retryTimer: NodeJS.Timeout | undefined;

// Remembers the group and starts the retry lazily; `unref` keeps the timer
// from holding the process open.
export function notePendingGroupSync(groupId: string, deps: TopicRoomDeps): void {
  pending.set(groupId, deps);
  if (retryTimer === undefined) {
    retryTimer = setInterval(() => {
      void drainPendingGroupSyncs();
    }, RETRY_INTERVAL_MS);
    retryTimer.unref();
  }
}

// One pass over pending groups; a group is dropped only when every room
// synced, else it stays for the next pass. Exported for the test.
export async function drainPendingGroupSyncs(): Promise<void> {
  for (const [groupId, deps] of pending) {
    const synced = await syncPendingGroup(groupId, deps);
    if (synced) {
      pending.delete(groupId);
    }
  }
}

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
        WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}
