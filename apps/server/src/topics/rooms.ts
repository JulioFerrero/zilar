import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient, RoomAffiliation } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { InviteLogger } from '../groups/service';
import { topicRoleHolderIds } from '../roles/service';
import { userIdsWithDevices } from '../push/store';
import { allowedTopicAiIds, visibleTopics, type TopicRow } from './access';

export interface TopicRoomDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

interface GroupMemberRow {
  userId: string;
  role: string;
}

function readGroupMembers(
  db: ServerDatabase,
  groupId: string,
): Promise<ReadonlyArray<GroupMemberRow>> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupMemberRow>`SELECT user_id, role FROM group_members
        WHERE group_id = ${groupId}`;
    }),
  );
}

// Who belongs in the topic's room: every group member for a public topic,
// `topic_members` plus the holders of its roles for a private one, plus the
// AI memberships — every `group_ais` AI for General, the topic's
// `topic_ais` rows otherwise.
// The return maps each JID to the affiliation it should hold: the group owner
// is the room's owner for General; for other topics the topic creator is
// owner (when they are still allowed in), everyone else is a member. AIs are
// always plain members. An AI that is not a member of a private topic is
// never included, even when it is in the group: the room itself enforces it.
// T-0124: a channel's General topic (its feed) keeps the voice mapping —
// owner stays `owner`, admins stay `admin` (voice in the moderated room),
// subscribers stay `member` (visitors, voiceless) — so a later join/leave
// re-sync never demotes an admin back to a subscriber.
export async function desiredMembers(
  db: ServerDatabase,
  topic: TopicRow,
  domain: string,
): Promise<Map<string, RoomAffiliation>> {
  const wanted = new Map<string, RoomAffiliation>();
  if (topic.visibility !== 'private') {
    const [group] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ kind: string }>`SELECT kind FROM "groups"
          WHERE id = ${topic.groupId} LIMIT 1`;
      }),
    );
    const isChannelFeed = topic.isGeneral && group?.kind === 'channel';
    const rows = await readGroupMembers(db, topic.groupId);
    for (const row of rows) {
      if (isChannelFeed && row.role === 'admin') {
        wanted.set(jidFor(localpartFor(row.userId), domain), 'admin');
        continue;
      }
      const ownerAffiliation = topic.isGeneral
        ? row.role === 'owner'
        : row.userId === topic.createdBy;
      wanted.set(jidFor(localpartFor(row.userId), domain), ownerAffiliation ? 'owner' : 'member');
    }
    await addTopicAiMembers(db, topic, wanted);
    // T-0124: an AI posts in the feed only while its owner is a channel
    // admin (the add flow already requires the actor to own the AI and
    // administer the channel). Admin-owned AIs hold affiliation `admin`
    // (voice); any other AI stays a voiceless `member`. Evaluated live, so
    // demoting the owner drops the AI's voice at the next sync without
    // deleting the row.
    if (isChannelFeed) {
      await applyChannelAiVoice(db, topic, wanted);
    }
    return wanted;
  }
  const groupRows = await readGroupMembers(db, topic.groupId);
  const byId = new Map(groupRows.map((row) => [row.userId, row.role]));
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topic.id}`;
    }),
  );
  // T-0116: holders of the topic's roles join too (still group members).
  // A holder who is also a direct member keeps their single affiliation.
  const holderIds = await topicRoleHolderIds(db, topic.id, topic.groupId);
  for (const row of memberRows) {
    // A stale `topic_members` row for a user who left the group no longer
    // counts: public sync would drop them, private sync must too.
    if (!byId.has(row.userId)) {
      continue;
    }
    const ownerAffiliation = topic.isGeneral
      ? byId.get(row.userId) === 'owner'
      : row.userId === topic.createdBy;
    wanted.set(jidFor(localpartFor(row.userId), domain), ownerAffiliation ? 'owner' : 'member');
  }
  for (const userId of holderIds) {
    const jid = jidFor(localpartFor(userId), domain);
    if (wanted.has(jid)) {
      continue;
    }
    const ownerAffiliation = topic.isGeneral
      ? byId.get(userId) === 'owner'
      : userId === topic.createdBy;
    wanted.set(jid, ownerAffiliation ? 'owner' : 'member');
  }
  await addTopicAiMembers(db, topic, wanted);
  return wanted;
}

// AI affiliations for one topic room: every group AI for General, the
// topic's allowed `topic_ais` rows otherwise (see `allowedTopicAiIds`: for a
// private topic an AI counts only while its owner is a topic member, so the
// sync removes the AI from the room once its owner is not a member —
// without deleting the row, so adding the owner back brings it back). Only
// active AIs join a room; a stale row for a stopped or disabled AI no longer
// counts. AIs invited into an archived topic are dropped too: archiving
// keeps the rows but the gateway leaves the room.
async function addTopicAiMembers(
  db: ServerDatabase,
  topic: TopicRow,
  wanted: Map<string, RoomAffiliation>,
): Promise<void> {
  if (topic.archivedAt !== null) {
    return;
  }
  if (topic.isGeneral) {
    const rows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ jid: string; status: string }>`SELECT ais.jid, ais.status FROM group_ais
          INNER JOIN "ais" ON "ais".id = group_ais.ai_id
          WHERE group_ais.group_id = ${topic.groupId}`;
      }),
    );
    for (const row of rows) {
      if (row.status === 'active' && !wanted.has(row.jid)) {
        wanted.set(row.jid, 'member');
      }
    }
    return;
  }
  const allowed = await allowedTopicAiIds(db, topic);
  if (allowed.size === 0) {
    return;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; jid: string }>`SELECT ais.id, ais.jid FROM topic_ais
        INNER JOIN "ais" ON "ais".id = topic_ais.ai_id
        WHERE topic_ais.topic_id = ${topic.id}`;
    }),
  );
  for (const row of rows) {
    if (allowed.has(row.id) && !wanted.has(row.jid)) {
      wanted.set(row.jid, 'member');
    }
  }
}

// T-0124: voice for AIs in a channel feed. Every active group AI whose
// owner is currently a channel owner/admin holds affiliation `admin`
// (voice, so the gateway's post lands); any other AI keeps `member`
// (a visitor: reads, cannot post). The `group_ais` rows never change —
// demoting the owner drops the voice at the next sync, re-promoting
// brings it back.
async function applyChannelAiVoice(
  db: ServerDatabase,
  topic: TopicRow,
  wanted: Map<string, RoomAffiliation>,
): Promise<void> {
  const aiRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        jid: string;
        owner: string;
        status: string;
      }>`SELECT ais.jid, ais.owner, ais.status FROM group_ais
        INNER JOIN "ais" ON "ais".id = group_ais.ai_id
        WHERE group_ais.group_id = ${topic.groupId}`;
    }),
  );
  if (aiRows.length === 0) {
    return;
  }
  const memberRows = await readGroupMembers(db, topic.groupId);
  const roleById = new Map(memberRows.map((row) => [row.userId, row.role]));
  for (const ai of aiRows) {
    if (ai.status !== 'active' || !wanted.has(ai.jid)) {
      continue;
    }
    const ownerRole = roleById.get(ai.owner);
    wanted.set(ai.jid, ownerRole === 'owner' || ownerRole === 'admin' ? 'admin' : 'member');
  }
}

export interface SyncTopicRoomResult {
  added: string[];
  removed: string[];
}

// Applies `desiredMembers` to the room: sets the missing affiliations, sends
// a direct invitation to newly added users, and sets `none` for anyone who
// should no longer be there (in a members-only room this removes them).
// Idempotent. Affiliation read/apply failures are logged by class name only
// and rethrown as a 502/503 `HttpError` so a route answers instead of
// leaving the database and the room disagreeing silently.
export async function syncTopicRoom(
  deps: TopicRoomDeps,
  topic: TopicRow,
): Promise<SyncTopicRoomResult> {
  let wanted: Map<string, RoomAffiliation>;
  try {
    wanted = await desiredMembers(deps.db, topic, deps.domain);
  } catch (error) {
    deps.logger.warn({ err: errorName(error) }, 'could not read the topic members');
    throw mapRoomError(error);
  }

  let current: Array<{ jid: string; affiliation: string }>;
  try {
    current = await deps.adminClient.getAffiliations(topic.roomLocalpart);
  } catch (error) {
    deps.logger.warn(
      { err: errorName(error), roomLocalpart: topic.roomLocalpart },
      'could not read the topic room affiliations',
    );
    throw mapRoomError(error);
  }

  const currentByJid = new Map(current.map((entry) => [entry.jid, entry.affiliation]));
  const added: string[] = [];
  const removed: string[] = [];
  for (const [jid, affiliation] of wanted) {
    if (currentByJid.get(jid) !== affiliation) {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, affiliation);
      } catch (error) {
        deps.logger.warn(
          { err: errorName(error), roomLocalpart: topic.roomLocalpart },
          'could not set the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      added.push(jid);
    }
  }
  for (const [jid] of currentByJid) {
    if (!wanted.has(jid) && currentByJid.get(jid) !== 'none') {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, 'none');
      } catch (error) {
        deps.logger.warn(
          { err: errorName(error), roomLocalpart: topic.roomLocalpart },
          'could not remove the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      removed.push(jid);
    }
  }

  if (added.length > 0) {
    try {
      await deps.adminClient.sendDirectInvitation(topic.roomLocalpart, added);
    } catch (error) {
      deps.logger.warn(
        { err: errorName(error), roomLocalpart: topic.roomLocalpart },
        'could not send the topic invitations',
      );
    }
  }
  await syncPushSubscriptions(deps, topic, wanted, currentByJid);
  return { added, removed };
}

// Push (T-0119): every desired member holding a push device is subscribed to
// the room (MUC/Sub, XEP-0369), so the room's messages reach them as push
// notifications while they have no session. Anyone who should no longer be
// there — a removed member, or someone a freshly private topic excludes — is
// unsubscribed again, and an archived topic unsubscribes everyone still
// affiliated. AIs never hold push devices and are skipped. Delivery sync is
// best effort next to the affiliation sync above: a failure is logged with
// the room localpart (never a topic name) and never thrown, so push can
// never break membership changes.
async function syncPushSubscriptions(
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
    // Archived topics are invisible to everyone: drop every push
    // subscription the room still holds, whether or not the JID is still
    // affiliated.
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
        { err: errorName(error), roomLocalpart: topic.roomLocalpart },
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
      { err: errorName(error), roomLocalpart: topic.roomLocalpart },
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

// Intersects the room's wanted and current JIDs with the users holding push
// devices. `undefined` when the device table cannot be read — push sync is
// skipped, affiliations already applied above still stand.
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
      { err: errorName(error), roomLocalpart: 'unknown' },
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

// The MUC/Sub subscription nick: the stable account localpart, never a
// display name.
function nickFor(userJid: string): string {
  return userJid.split('@')[0] ?? userJid;
}

export interface PushUserSyncDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

// Re-applies one user's room subscriptions after their device set changed:
// with at least one device they are subscribed to every room they may see
// (their groups' General rooms plus visible topics); with none left they
// are unsubscribed from all of them, so ejabberd stops publishing for a
// user who cannot receive anything. Best effort: failures are logged per
// room (localpart only, never a topic name) and never thrown.
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
        { err: errorName(error), roomLocalpart },
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

export interface RoomOptionsReconcileDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  logger: InviteLogger;
}

// One-time reconcile for rooms created before push: enables MUC/Sub
// subscriptions (`allow_subscription`) on every topic room through
// `change_room_option`. New rooms are created with the option set. Runs at
// push-component startup; per-room failures are logged (localpart only)
// and never thrown, so one bad room cannot keep push from starting.
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
        { err: errorName(error), roomLocalpart: row.roomLocalpart },
        'could not enable room subscriptions for push',
      );
    }
  }
}

function mapRoomError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
