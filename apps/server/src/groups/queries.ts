import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerDatabase } from '../db/client';
import type { GroupMemberRow, GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { roleHoldersByGroup } from '../roles/service';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { handleForGroup } from './visibility';
import { isGroupManagerRole } from './access';
import {
  ROOM_ROLES,
  type ChatGroup,
  type GroupAiView,
  type GroupDetail,
  type GroupMemberView,
  type GroupRole,
} from './schemas';

export async function getGroupDetail(
  db: ServerDatabase,
  groupId: string,
  listenerAvailable = false,
): Promise<GroupDetail | null> {
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    return null;
  }
  const members = await listGroupMembers(db, groupId);
  const aiViews = await listGroupAis(db, groupId);
  const handle = await handleForGroup(db, groupId);
  const [groupAvatar, aiAvatars] = await Promise.all([
    avatarIdsByOwner(db, 'group', [groupId]),
    avatarIdsByOwner(
      db,
      'ai',
      aiViews.map((ai) => ai.aiId),
    ),
  ]);
  const avatarId = groupAvatar.get(groupId);
  return {
    id: group.id,
    title: group.title,
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    membersCanCreateTopics: group.membersCanCreateTopics,
    kind: group.kind,
    description: group.description,
    visibility: group.visibility,
    handle,
    ...(avatarId === undefined ? {} : { avatarUrl: avatarUrlFor(avatarId) }),
    background: {
      backgroundPreset: group.backgroundPreset,
      backgroundImageId: group.backgroundImageId,
      backgroundDim: group.backgroundDim,
    },
    listener: {
      enabled: group.listenerEnabled,
      eagerness: group.listenerEagerness,
      available: listenerAvailable,
    },
    members,
    ais: aiViews.map((ai) =>
      aiAvatars.get(ai.aiId) === undefined
        ? ai
        : { ...ai, avatarUrl: avatarUrlFor(aiAvatars.get(ai.aiId)!) },
    ),
  };
}

export async function getMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: GroupRole } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupMemberRow>`SELECT * FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// The owner id, or null; join flows read it to refuse someone the owner
// blocked.
export async function groupOwnerId(db: ServerDatabase, groupId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND role = 'owner' LIMIT 1`;
    }),
  );
  return row?.userId ?? null;
}

// A channel must keep at least one admin besides the target (the owner
// always counts) or answer 409 `channel_needs_admin`, so the feed keeps a
// voice. The check and write are not atomic: two concurrent demotions can
// both pass and leave the channel owner-only until someone is promoted.
export async function assertChannelKeepsAnAdmin(
  db: ServerDatabase,
  groupId: string,
  losingUserId: string,
): Promise<void> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; role: GroupRole }>`SELECT user_id, role
        FROM group_members WHERE group_id = ${groupId}`;
    }),
  );
  const adminsLeft = rows.some((row) => row.userId !== losingUserId && row.role === 'admin');
  if (!adminsLeft) {
    throw new HttpError(
      409,
      'channel_needs_admin',
      'A channel needs at least one admin besides the owner',
    );
  }
}

// Admins see everyone; a channel subscriber sees only owner/admins, whose
// names are public on posts, never the audience. Never 404s for a member, so
// subscribers can tell `hidden` from `gone` by the detail they hold.
export async function listMembersForViewer(
  db: ServerDatabase,
  groupId: string,
  viewerId: string,
): Promise<{ members: GroupMemberView[]; isAdmin: boolean }> {
  const viewer = await getMembership(db, groupId, viewerId);
  if (!viewer) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const isAdmin = isGroupManagerRole(viewer.role);
  const all = await listGroupMembers(db, groupId);
  if (group.kind === 'channel' && !isAdmin) {
    return { members: all.filter((member) => member.role !== 'member'), isAdmin };
  }
  return { members: all, isAdmin };
}

export async function listGroupsForUser(db: ServerDatabase, userId: string): Promise<ChatGroup[]> {
  const memberships = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string; role: GroupRole }>`SELECT group_id, role
        FROM group_members WHERE user_id = ${userId}`;
    }),
  );
  if (memberships.length === 0) {
    return [];
  }

  const groupIds = memberships.map((row) => row.groupId);
  const groupRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<
        Pick<
          GroupRow,
          | 'id'
          | 'roomLocalpart'
          | 'title'
          | 'createdAt'
          | 'kind'
          | 'description'
          | 'visibility'
          | 'backgroundPreset'
          | 'backgroundImageId'
          | 'backgroundDim'
        >
      >`SELECT id, room_localpart, title, created_at, kind, description, visibility,
        background_preset, background_image_id, background_dim
        FROM groups WHERE id IN ${sql.in(groupIds)}`;
    }),
  );
  // A group's members are its people and AIs, so the count sums
  // `group_members` and `group_ais` in one query.
  const counts = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string; total: number }>`SELECT group_id, count(*)::int AS total
        FROM (
          SELECT group_id FROM group_members WHERE group_id IN ${sql.in(groupIds)}
          UNION ALL
          SELECT group_id FROM group_ais WHERE group_id IN ${sql.in(groupIds)}
        ) AS participants
        GROUP BY group_id`;
    }),
  );
  const handleRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string | null; handle: string }>`SELECT group_id, handle
        FROM handles WHERE group_id IN ${sql.in(groupIds)}`;
    }),
  );

  const groupsById = new Map(groupRows.map((row) => [row.id, row]));
  const countsById = new Map(counts.map((row) => [row.groupId, Number(row.total)]));
  const handlesById = new Map<string, string>();
  for (const row of handleRows) {
    if (row.groupId !== null) {
      handlesById.set(row.groupId, row.handle);
    }
  }

  return memberships.flatMap((membership) => {
    const group = groupsById.get(membership.groupId);
    if (!group) {
      return [];
    }
    return [
      {
        id: group.id,
        roomLocalpart: group.roomLocalpart,
        title: group.title,
        createdAt: group.createdAt,
        memberCount: countsById.get(group.id) ?? 0,
        role: membership.role,
        kind: group.kind,
        description: group.description,
        visibility: group.visibility,
        handle: handlesById.get(group.id) ?? null,
        background: {
          backgroundPreset: group.backgroundPreset,
          backgroundImageId: group.backgroundImageId,
          backgroundDim: group.backgroundDim,
        },
      },
    ];
  });
}

async function listGroupMembers(db: ServerDatabase, groupId: string): Promise<GroupMemberView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        userId: string;
        role: GroupRole;
        name: string;
        handle: string | null;
      }>`SELECT group_members.user_id, group_members.role, "user".name, handles.handle
        FROM group_members
        INNER JOIN "user" ON "user".id = group_members.user_id
        LEFT JOIN handles ON handles.user_id = group_members.user_id
        WHERE group_members.group_id = ${groupId}`;
    }),
  );

  // Fold each member's custom roles and picture into the same row, one query.
  // Role membership is not secret: every member sees the same list.
  const byUser = await roleHoldersByGroup(db, groupId);
  const memberAvatars = await avatarIdsByOwner(
    db,
    'user',
    rows.map((row) => row.userId),
  );
  return rows
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
      roles: byUser.get(row.userId) ?? [],
      ...(row.handle ? { handle: row.handle } : {}),
      ...(memberAvatars.get(row.userId) === undefined
        ? {}
        : { avatarUrl: avatarUrlFor(memberAvatars.get(row.userId)!) }),
    }))
    .sort(
      (a, b) =>
        ROOM_ROLES[a.role] - ROOM_ROLES[b.role] ||
        a.name.localeCompare(b.name) ||
        a.userId.localeCompare(b.userId),
    );
}

async function listGroupAis(db: ServerDatabase, groupId: string): Promise<GroupAiView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string; jid: string; name: string; ownerId: string }>`SELECT
        group_ais.ai_id, ais.jid, ais.name, ais.owner AS owner_id
        FROM group_ais INNER JOIN ais ON ais.id = group_ais.ai_id
        WHERE group_ais.group_id = ${groupId}`;
    }),
  );

  return rows
    .map((row) => ({ aiId: row.aiId, jid: row.jid, name: row.name, ownerId: row.ownerId }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.aiId.localeCompare(b.aiId));
}

export async function requireGroup(db: ServerDatabase, groupId: string) {
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  return group;
}

export async function destroyQuietly(
  adminClient: EjabberdAdminClient,
  roomLocalpart: string,
): Promise<void> {
  try {
    await adminClient.destroyRoom(roomLocalpart);
  } catch {
    // Best effort: the database rows are rolled back either way.
  }
}
