import { Duration, Effect, Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { GroupMemberRow } from '../db/rows';
import type { TopicRow } from '../topics/access';
import { runSql } from '../effect/sql';
import { toBigInt } from '../chats/unread';
import { bareJid } from '../jid';
import { liveAiUiIds } from '../notify/ai-cards';
import type { SearchOwner } from '../search/service';
import { localpartFor } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { readGroupchatPage, type GroupchatRow } from './archive-scan';
import { albumKey } from './album-key';
import { deliverToDevice } from './delivery';
import { resolveCandidate } from './candidates';
import type { PushServiceDeps } from './service';
import { devicesForUser, markDeviceUsed } from './store';

// Server-side group push: ejabberd's MAM trigger handles only `chat`, and a
// user with no session is not a room occupant, so group and topic messages
// never publish. This fiber polls for new `groupchat` rows and notifies each
// offline member with the DM path's mute, visibility, preview and dedupe
// rules.

export const GROUP_NOTIFIER_INTERVAL_MS = 3000;
const GROUP_NOTIFIER_PAGE_SIZE = 200;
// The connectivity answer is cached per user while a tick runs.
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
    // Begin from now: rows archived before the deploy are never pushed.
    cursor: { timestampMicros: BigInt(now.getTime()) * 1000n, rowId: 0n },
    resourceCache: new Map(),
  };
}

// The room's topic (General plus every topic room archives under its own
// localpart); a row for an unknown room answers nothing.
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

// The room's group members via its topic, using the groups code's read.
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
  // An ejabberd failure only skips the member for this tick.
  const connected = (await deps.admin.userResources(localpart)).length > 0;
  state.resourceCache.set(localpart, { connected, at });
  return connected;
}

// One member and one row: skip the sender and members with a session,
// resolve with the DM path's verdict, deliver once per node. A row ejabberd
// already notified stays silent through `recentlyNotified`.
async function notifyMemberForRow(
  deps: GroupNotifierDeps,
  memberId: string,
  row: GroupchatRow,
  senderLocalpart: string,
  at: number,
  state: GroupNotifierState,
  liveIds: ReadonlySet<string>,
): Promise<void> {
  const localpart = localpartFor(memberId);
  if (localpart === senderLocalpart) {
    return;
  }
  if (await isConnected(deps, state, localpart, at)) {
    return;
  }
  // `resolveCandidate` ignores the scope for `groupchat`, so the member only
  // needs a stub owner.
  const owner: SearchOwner = {
    ownLocalpart: localpart,
    dmPeers: [],
    rooms: [],
    peerNames: new Map(),
  };
  // Groupchat rows carry an archive-only `id` that `resolveCandidate` never
  // reads; `liveIds` are the page's live-UI ids, so a card edit is skipped.
  const verdict = await resolveCandidate(deps.service, memberId, owner, row, liveIds);
  if (verdict.status !== 'ok') {
    return;
  }
  const devices = await devicesForUser(deps.service.db, memberId);
  const scan = {
    newest: { message: verdict.message },
    notify: [row.originId],
    saw: 'duplicate' as const,
  };
  // One album is one push per device: a remembered sender key keeps siblings
  // silent.
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
  liveIds: ReadonlySet<string>,
): Promise<void> {
  if (row.originId === '') {
    return;
  }
  const roomLocalpart = (row.owner.split('@')[0] ?? '').toLowerCase();
  const topic = await topicForRoom(deps, roomLocalpart);
  if (topic === undefined) {
    return;
  }
  // The nick is display text; the sender's localpart comes from `bare_peer`.
  // Only a legacy row with none falls back to the nick.
  const senderLocalpart =
    row.barePeer === '' ? row.nick.toLowerCase() : (bareJid(row.barePeer).split('@')[0] ?? '');
  for (const memberId of await memberIdsForTopic(deps, topic)) {
    try {
      await notifyMemberForRow(deps, memberId, row, senderLocalpart, at, state, liveIds);
    } catch {
      // Ids only, never message text.
      deps.logger.warn(
        { userId: memberId, originId: row.originId },
        'group push member notify failed; continuing with the next member',
      );
    }
  }
}

// One poll: read rows newer than the cursor, notify, advance to the newest;
// a failed tick logs at `warn` and the loop goes on.
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
    // The page's live-UI ids, so a progress card and its edits never notify.
    const liveIds = liveAiUiIds(rows);
    for (const row of rows) {
      await notifyRow(deps, state, row, at, liveIds);
      const timestampMicros = toBigInt(row.timestamp);
      const rowId = toBigInt(row.id);
      if (
        timestampMicros > state.cursor.timestampMicros ||
        (timestampMicros === state.cursor.timestampMicros && rowId > state.cursor.rowId)
      ) {
        state.cursor = { timestampMicros, rowId };
      }
    }
  } catch {
    // The error may echo a request and rows carry message text, so a failed tick
    // logs only that it failed.
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
