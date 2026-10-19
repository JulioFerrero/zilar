import type { ServerCore } from '../app/deps';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { errorClassName } from '../effect/error-utils';
import { runSql } from '../effect/sql';

import type { RoomAffiliation } from '../xmpp/admin/schemas';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { InviteLogger } from '../groups/service';
import { userIdsWithDevices } from '../push/store';
import { visibleTopics, type TopicRow } from './access';
import type { PushUserSyncDeps, TopicRoomDeps } from './rooms';

// Every desired member holding a push device is subscribed to the room
// (MUC/Sub), so its messages reach them while they have no session; anyone
// who should no longer be there is unsubscribed, and an archived topic
// unsubscribes everyone. AIs never hold devices. Best effort: a failure is
// logged with the room localpart, never a topic name.
export async function syncPushSubscriptions(
  deps: TopicRoomDeps,
  topic: TopicRow,
  wanted: Map<string, RoomAffiliation>,
  currentByJid: Map<string, string>,
): Promise<void> {
  const holders = await pushDeviceHolders(deps, wanted, currentByJid);
  if (holders === undefined) {
    return;
  }
  const { subscribe, unsubscribe } = holders;
  if (topic.archivedAt !== null) {
    // Archived topics are invisible: drop every push subscription the room
    // still holds.
    for (const jid of holders.affiliated) {
      await unsubscribeOne(deps, topic, jid);
    }
    for (const jid of subscribe) {
      if (!holders.affiliated.has(jid)) {
        await unsubscribeOne(deps, topic, jid);
      }
    }
    return;
  }
  for (const jid of subscribe) {
    try {
      await deps.adminClient.subscribeRoom(topic.roomLocalpart, jid, nickFor(jid));
    } catch (error) {
      deps.logger.warn(
        { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
        'could not subscribe the room for push',
      );
    }
  }
  for (const jid of unsubscribe) {
    await unsubscribeOne(deps, topic, jid);
  }
}

async function unsubscribeOne(deps: TopicRoomDeps, topic: TopicRow, jid: string): Promise<void> {
  try {
    await deps.adminClient.unsubscribeRoom(topic.roomLocalpart, jid);
  } catch (error) {
    deps.logger.warn(
      { err: errorClassName(error), roomLocalpart: topic.roomLocalpart },
      'could not unsubscribe the room for push',
    );
  }
}

interface PushDeviceHolders {
  /** Desired members holding a push device: subscribe these. */
  subscribe: Set<string>;
  /** Affiliated JIDs that fell out of the desired set: unsubscribe these. */
  unsubscribe: Set<string>;
  /** Every affiliated user JID (for the archived-topic sweep above). */
  affiliated: Set<string>;
}

// Intersects the wanted and current JIDs with users holding push devices;
// `undefined` when the device table cannot be read, so affiliations already
// applied still stand.
async function pushDeviceHolders(
  deps: TopicRoomDeps,
  wanted: Map<string, RoomAffiliation>,
  currentByJid: Map<string, string>,
): Promise<PushDeviceHolders | undefined> {
  let userIds: Set<string>;
  try {
    userIds = await userIdsWithDevices(deps.db);
  } catch (error) {
    deps.logger.warn(
      { err: errorClassName(error), roomLocalpart: 'unknown' },
      'could not read the push devices; skipping the push sync',
    );
    return undefined;
  }
  if (userIds.size === 0) {
    return { subscribe: new Set(), unsubscribe: new Set(), affiliated: new Set() };
  }
  const deviceJids = new Map<string, string>();
  for (const userId of userIds) {
    deviceJids.set(jidFor(localpartFor(userId), deps.domain), userId);
  }
  const subscribe = new Set<string>();
  for (const jid of wanted.keys()) {
    if (deviceJids.has(jid)) {
      subscribe.add(jid);
    }
  }
  const unsubscribe = new Set<string>();
  const affiliated = new Set<string>();
  for (const jid of currentByJid.keys()) {
    if (!deviceJids.has(jid)) {
      continue;
    }
    affiliated.add(jid);
    if (!wanted.has(jid)) {
      unsubscribe.add(jid);
    }
  }
  return { subscribe, unsubscribe, affiliated };
}

// The MUC/Sub nick: the stable account localpart, never a display name.
function nickFor(userJid: string): string {
  return userJid.split('@')[0] ?? userJid;
}

// Re-applies one user's room subscriptions after their device set changed:
// with a device they follow every room they may see; with none they are
// unsubscribed, so ejabberd stops publishing. Best effort, logged per room.
export async function syncPushSubscriptionsForUser(
  deps: PushUserSyncDeps,
  userId: string,
): Promise<void> {
  const rooms = await visibleRoomLocalparts(deps.db, userId);
  const userJid = jidFor(localpartFor(userId), deps.domain);
  const devices = await userIdsWithDevices(deps.db);
  const subscribe = devices.has(userId);
  for (const roomLocalpart of rooms) {
    try {
      if (subscribe) {
        await deps.adminClient.subscribeRoom(roomLocalpart, userJid, nickFor(userJid));
      } else {
        await deps.adminClient.unsubscribeRoom(roomLocalpart, userJid);
      }
    } catch (error) {
      deps.logger.warn(
        { err: errorClassName(error), roomLocalpart },
        'could not sync the room push subscription',
      );
    }
  }
}

async function visibleRoomLocalparts(db: ServerDatabase, userId: string): Promise<string[]> {
  const memberships = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${userId}`;
    }),
  );
  const rooms = new Set<string>();
  for (const membership of memberships) {
    for (const topic of await visibleTopics(db, membership.groupId, userId)) {
      rooms.add(topic.roomLocalpart);
    }
  }
  return [...rooms];
}

export interface RoomOptionsReconcileDeps extends Pick<ServerCore, 'db' | 'adminClient'> {
  logger: InviteLogger;
}

// One-time reconcile for rooms created before push: enable
// `allow_subscription` on every topic room; new rooms set it at creation.
// Per-room failures are logged and never thrown.
export async function reconcileRoomSubscriptionOptions(
  deps: RoomOptionsReconcileDeps,
): Promise<void> {
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roomLocalpart: string }>`SELECT room_localpart FROM topics`;
    }),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.roomLocalpart)) {
      continue;
    }
    seen.add(row.roomLocalpart);
    try {
      await deps.adminClient.changeRoomOption(row.roomLocalpart, 'allow_subscription', 'true');
    } catch (error) {
      deps.logger.warn(
        { err: errorClassName(error), roomLocalpart: row.roomLocalpart },
        'could not enable room subscriptions for push',
      );
    }
  }
}
