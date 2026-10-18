import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { errorClassName } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import type { TopicRow } from '../topics/access';
import { syncTopicRoom } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { InviteLogger } from './schemas';

export interface RoomReconcileLogger extends InviteLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
}

export interface RoomReconcileDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: RoomReconcileLogger;
  signal?: AbortSignal;
  pauseMs?: number;
}

// About three rooms per second keeps the admin API and ejabberd calm.
const DEFAULT_PAUSE_MS = 350;

const PRIVATE_ROOM_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['members_only', 'true'],
  ['public', 'false'],
  ['public_list', 'false'],
];

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function liveTopics(db: ServerDatabase): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE archived_at IS NULL`;
    }),
  );
  return [...rows];
}

async function reconcileRoom(deps: RoomReconcileDeps, topic: TopicRow): Promise<boolean> {
  try {
    await syncTopicRoom(
      { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
      topic,
    );
    for (const [option, value] of PRIVATE_ROOM_OPTIONS) {
      await deps.adminClient.changeRoomOption(topic.roomLocalpart, option, value);
    }
    return true;
  } catch (error) {
    deps.logger.warn(
      { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
      'could not reconcile a room',
    );
    return false;
  }
}

// T-2002: rooms created before the hardening still carry person-held owner or
// admin affiliations and ejabberd's listable defaults. Once per leader start,
// re-sync every live group and topic room (each group's room is its General
// topic's room): `syncTopicRoom` applies the plain `member` affiliations, then
// the room options are set again. Idempotent, throttled, and one summary line;
// a room that fails is logged by localpart and never stops the pass. Archived
// topics are not swept here: a removal re-syncs them (`syncGroupTopicRooms`).
export async function reconcileRoomRights(deps: RoomReconcileDeps): Promise<void> {
  const pauseMs = deps.pauseMs ?? DEFAULT_PAUSE_MS;
  const topics = await liveTopics(deps.db);
  let reconciled = 0;
  let failed = 0;
  for (const topic of topics) {
    if (deps.signal?.aborted) {
      break;
    }
    if (await reconcileRoom(deps, topic)) {
      reconciled += 1;
    } else {
      failed += 1;
    }
    await pause(pauseMs);
  }
  deps.logger.info(
    { rooms: topics.length, reconciled, failed, interrupted: deps.signal?.aborted === true },
    'room rights reconcile finished',
  );
}
