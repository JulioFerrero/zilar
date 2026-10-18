import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { RoomAffiliation } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { topicRoleHolderIds } from '../roles/service';
import { allowedTopicAiIds, type TopicRow } from './access';

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

// T-2002: people never hold the MUC `owner` or `admin` affiliation, because a
// raw XMPP client could use it to change the room config or grant membership.
// The server does every membership change through the admin API, so people are
// plain `member`s. The one exception is a channel's General room (its feed):
// the room is moderated, and ejabberd persists voice only through an `admin`
// or `owner` affiliation, so the channel's owner and admins hold `admin` there
// and nowhere else. The reconcile re-asserts the room's membership rules.
export function roomAffiliationFor(role: string, isChannelFeed: boolean): RoomAffiliation {
  return isChannelFeed && (role === 'owner' || role === 'admin') ? 'admin' : 'member';
}

// Who belongs in the topic's room: every group member for General,
// `topic_members` plus the holders of its roles for every other topic, plus
// the AI memberships — every `group_ais` AI for General, the topic's
// `topic_ais` rows otherwise.
// The return maps each JID to the affiliation it should hold (see
// `roomAffiliationFor`): people are `member`s, with the channel feed's owner
// and admins as the voice exception. AIs are plain members. An AI that is not
// a member of a non-General topic is never included, even when it is in the
// group: the room itself enforces it.
// T-0124: a channel's General topic (its feed) keeps the voice mapping —
// owner and admins keep voice, subscribers stay `member` (visitors,
// voiceless) — so a later join/leave re-sync never demotes an admin back to a
// subscriber.
export async function desiredMembers(
  db: ServerDatabase,
  topic: TopicRow,
  domain: string,
): Promise<Map<string, RoomAffiliation>> {
  const wanted = new Map<string, RoomAffiliation>();
  // T-1757: only General is the whole group; every other topic follows the
  // `topic_members` plus role holders branch below.
  if (topic.isGeneral) {
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
      wanted.set(
        jidFor(localpartFor(row.userId), domain),
        roomAffiliationFor(row.role, isChannelFeed),
      );
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
    wanted.set(jidFor(localpartFor(row.userId), domain), 'member');
  }
  for (const userId of holderIds) {
    const jid = jidFor(localpartFor(userId), domain);
    if (wanted.has(jid)) {
      continue;
    }
    wanted.set(jid, 'member');
  }
  await addTopicAiMembers(db, topic, wanted);
  return wanted;
}

// AI affiliations for one topic room: every group AI for General, the
// topic's allowed `topic_ais` rows otherwise (see `allowedTopicAiIds`: for a
// non-General topic an AI counts only while its owner is a topic member, so the
// sync removes the AI from the room once its owner is not a member —
// without deleting the row, so adding the owner back brings it back). For
// General the same owner rule applies: the AI counts only while its owner is
// still a group member (T-1990), so a removed member's AI leaves the room even
// if a cleanup write failed. Only active AIs join a room; a stale row for a
// stopped or disabled AI no longer counts. AIs invited into an archived topic
// are dropped too: archiving keeps the rows but the gateway leaves the room.
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
        return yield* sql<{ jid: string; status: string }>`SELECT "ais".jid, "ais".status
          FROM group_ais
          INNER JOIN "ais" ON "ais".id = group_ais.ai_id
          INNER JOIN group_members gm ON gm.group_id = group_ais.group_id
            AND gm.user_id = "ais".owner
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
