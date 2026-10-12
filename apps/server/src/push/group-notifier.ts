import { Duration, Effect, Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { GroupMemberRow } from '../db/rows';
import type { TopicRow } from '../topics/access';
import { runSql } from '../effect/sql';
import type { SearchOwner } from '../search/service';
import { localpartFor } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { readGroupchatPage, type GroupchatRow } from './archive-scan';
import { albumKey } from './album-key';
import { deliverToDevice } from './delivery';
import { resolveCandidate } from './candidates';
import type { PushServiceDeps } from './service';
import { devicesForUser, markDeviceUsed } from './store';

// Server-side group push (F5/MP-3). ejabberd's MAM push trigger handles only
// `chat`: a user with no session is not a room occupant, so group and topic
// messages never publish to them. This fiber polls the archive for new
// `groupchat` rows and notifies each member who has no XMPP resource online,
// applying the same mute, visibility and preview rules plus the same
// per-node dedupe as the DM path. It runs whenever push is on.

export const GROUP_NOTIFIER_INTERVAL_MS = 3000;
const GROUP_NOTIFIER_PAGE_SIZE = 200;
// The connectivity answer is cached per user while a tick runs: one member
// posting in many rooms (or many member rows for one room) asks ejabberd once.
const RESOURCE_CACHE_TTL_MS = 2000;

export interface GroupNotifierDeps {
  service: PushServiceDeps;
  /** Narrowed so tests hand over a record with only `userResources`. */
  admin: Pick<EjabberdAdminClient, 'userResources'>;
  logger: PushServiceDeps['logger'];
  now?: () => Date;
  pollIntervalMs?: number;
}

export interface GroupNotifierState {
  cursor: { timestampMicros: bigint; rowId: bigint };
  resourceCache: Map<string, { connected: boolean; at: number }>;
}

export interface GroupNotifierHandle {
  tick: () => Promise<void>;
  stop: () => Promise<void>;
}

export function initialGroupNotifierState(now: Date): GroupNotifierState {
  return {
    // Begin from "now": rows archived before the deploy are never pushed.
    cursor: { timestampMicros: BigInt(now.getTime()) * 1000n, rowId: 0n },
    resourceCache: new Map(),
  };
}

function toMicros(value: number | string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function toRowId(value: number | string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

// The room's topic (the group's General room plus every topic room archives
// under its own localpart), the same lookup `resolveCandidate` starts from.
// An archive row for a room we no longer know answers nothing.
async function topicForRoom(
  deps: GroupNotifierDeps,
  roomLocalpart: string,
): Promise<TopicRow | undefined> {
  const [topic] = await runSql(
    deps.service.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE room_localpart = ${roomLocalpart} LIMIT 1`;
    }),
  );
  return topic;
}

// The room's group members, joining the group the topic belongs to — the
// groups code's own member read (`groups/queries.ts:265`, `group_members` by
// `group_id`, like `groups/ais.ts:78`) through the row's topic.
async function memberIdsForTopic(deps: GroupNotifierDeps, topic: TopicRow): Promise<string[]> {
  const rows = await runSql(
    deps.service.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Pick<GroupMemberRow, 'userId'>>`SELECT user_id FROM group_members
        WHERE group_id = ${topic.groupId}`;
    }),
  );
  return rows.map((row) => row.userId);
}

async function isConnected(
  deps: GroupNotifierDeps,
  state: GroupNotifierState,
  localpart: string,
  at: number,
): Promise<boolean> {
  const cached = state.resourceCache.get(localpart);
  if (cached !== undefined && at - cached.at < RESOURCE_CACHE_TTL_MS) {
    return cached.connected;
  }
  // An ejabberd failure only skips the member for this tick: it throws into
  // the per-row handler, which logs and moves on.
  const connected = (await deps.admin.userResources(localpart)).length > 0;
  state.resourceCache.set(localpart, { connected, at });
  return connected;
}

// One member and one row: skip the sender and members with a session,
// resolve the row with the same verdict the DM path uses (mute, hidden,
// previews), and deliver to each of the member's devices exactly once per
// node. A row ejabberd's own publish already notified (a pending session the
// notifier still sees as resourced) stays silent through `recentlyNotified`.
async function notifyMemberForRow(
  deps: GroupNotifierDeps,
  memberId: string,
  row: GroupchatRow,
  senderLocalpart: string,
  at: number,
  state: GroupNotifierState,
): Promise<void> {
  const localpart = localpartFor(memberId);
  if (localpart === senderLocalpart) {
    return;
  }
  if (await isConnected(deps, state, localpart, at)) {
    return;
  }
  // `resolveCandidate` ignores the scope for `groupchat` rows (it resolves
  // the room from our own topics), so the member only needs a stub owner.
  const owner: SearchOwner = {
    ownLocalpart: localpart,
    dmPeers: [],
    rooms: [],
    peerNames: new Map(),
  };
  // Groupchat page rows carry the archive-only ordering `id`, which
  // `resolveCandidate` never reads.
  const verdict = await resolveCandidate(deps.service, memberId, owner, row);
  if (verdict.status !== 'ok') {
    return;
  }
  const devices = await devicesForUser(deps.service.db, memberId);
  const scan = {
    newest: { message: verdict.message },
    notify: [row.originId],
    saw: 'duplicate' as const,
  };
  // One album is one push per device (T-1270): a sibling row whose album
  // sender key is already remembered stays silent, exactly like a repeated
  // origin id.
  const key = albumKey(verdict.message);
  for (const device of devices) {
    const seen = deps.service.recentlyNotified.get(device.node);
    if (seen !== undefined && (seen.has(row.originId) || (key !== undefined && seen.has(key)))) {
      continue;
    }
    const outcome = await Effect.runPromise(
      deliverToDevice(deps.service, device, scan).pipe(
        Effect.catchCause(() =>
          Effect.sync(() => {
            deps.logger.warn(
              { userId: device.userId, deviceId: device.id },
              'group push delivery failed; continuing with the next device',
            );
            return {
              kind: 'dropped' as const,
              userId: device.userId,
              deviceId: device.id,
              reason: 'send-failed' as const,
            };
          }),
        ),
      ),
    );
    if (outcome.kind === 'sent') {
      await markDeviceUsed(deps.service.db, device.id, new Date(at));
    }
  }
}

async function notifyRow(
  deps: GroupNotifierDeps,
  state: GroupNotifierState,
  row: GroupchatRow,
  at: number,
): Promise<void> {
  if (row.originId === '') {
    return;
  }
  const roomLocalpart = (row.owner.split('@')[0] ?? '').toLowerCase();
  const topic = await topicForRoom(deps, roomLocalpart);
  if (topic === undefined) {
    return;
  }
  const senderLocalpart = row.nick.toLowerCase();
  for (const memberId of await memberIdsForTopic(deps, topic)) {
    try {
      await notifyMemberForRow(deps, memberId, row, senderLocalpart, at, state);
    } catch {
      // Ids only, never message text.
      deps.logger.warn(
        { userId: memberId, originId: row.originId },
        'group push member notify failed; continuing with the next member',
      );
    }
  }
}

// One poll: read the rows newer than the cursor, notify, and advance the
// cursor to the newest row read. A failed tick logs at `warn` (never message
// text) and the loop goes on; the cursor only moves past rows that were read.
export async function runGroupNotifierTick(
  deps: GroupNotifierDeps,
  state: GroupNotifierState,
): Promise<void> {
  const at = (deps.now ?? (() => new Date()))().getTime();
  try {
    const rows = await readGroupchatPage(deps.service.archive, {
      afterTimestamp: state.cursor.timestampMicros,
      afterId: state.cursor.rowId,
      limit: GROUP_NOTIFIER_PAGE_SIZE,
    });
    for (const row of rows) {
      await notifyRow(deps, state, row, at);
      const timestampMicros = toMicros(row.timestamp);
      const rowId = toRowId(row.id);
      if (
        timestampMicros > state.cursor.timestampMicros ||
        (timestampMicros === state.cursor.timestampMicros && rowId > state.cursor.rowId)
      ) {
        state.cursor = { timestampMicros, rowId };
      }
    }
  } catch {
    // A failed tick logs at `warn` and the loop goes on: the error shape may
    // echo a request, and rows may carry message text, so nothing from it is
    // logged — only the fact that the tick failed.
    deps.logger.warn({}, 'group push tick failed; continuing with the next tick');
  }
}

export function startGroupNotifier(deps: GroupNotifierDeps): GroupNotifierHandle {
  const state = initialGroupNotifierState((deps.now ?? (() => new Date()))());
  const tick = () => runGroupNotifierTick(deps, state);
  const fiber = Effect.runFork(
    (function loop(): Effect.Effect<void> {
      return Effect.promise(tick).pipe(
        Effect.andThen(
          Effect.sleep(Duration.millis(deps.pollIntervalMs ?? GROUP_NOTIFIER_INTERVAL_MS)),
        ),
        Effect.andThen(loop),
      );
    })(),
  );
  return {
    tick,
    stop: () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.asVoid)),
  };
}
