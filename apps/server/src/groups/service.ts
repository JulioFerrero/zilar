import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
import { findOwnedAi } from '../ais/service';
import type { ServerDatabase } from '../db/client';
import { ais, contacts, groupAis, groupMembers, groups, user } from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { emitGroupAi } from './events';

export const MAX_GROUP_MEMBERS = 50;
export const ROOM_LOCALPART_LENGTH = 16;

const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ROOM_ROLES = { owner: 0, admin: 1, member: 2 } as const;

export type GroupRole = 'owner' | 'admin' | 'member';

// Minimal slice of pino's Logger the invite sending needs.
export interface InviteLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface GroupMemberView {
  userId: string;
  name: string;
  role: GroupRole;
}

export interface GroupDetail {
  id: string;
  title: string;
  createdBy: string;
  createdAt: Date;
  members: GroupMemberView[];
  ais: GroupAiView[];
}

export interface GroupAiView {
  aiId: string;
  jid: string;
  name: string;
  ownerId: string;
}

export interface ChatGroup {
  id: string;
  roomLocalpart: string;
  title: string;
  memberCount: number;
  role: GroupRole;
}

export interface CreateGroupInput {
  creatorId: string;
  title: string;
  memberIds: string[];
  domain: string;
  logger: InviteLogger;
}

export interface AddGroupMembersInput {
  groupId: string;
  actorId: string;
  userIds: string[];
  domain: string;
  logger: InviteLogger;
}

export interface RemoveGroupMemberInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  domain: string;
}

export interface AddGroupAiInput {
  groupId: string;
  actorId: string;
  aiId: string;
}

export interface RemoveGroupAiInput {
  groupId: string;
  actorId: string;
  aiId: string;
}

// `g` followed by 16 random lowercase base32 characters. Never derived from the
// title, so a rename (later) can never collide or leak anything.
export function randomRoomLocalpart(): string {
  const bytes = randomBytes(ROOM_LOCALPART_LENGTH);
  let localpart = 'g';
  for (const byte of bytes) {
    localpart += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  }
  return localpart;
}

export async function createGroup(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: CreateGroupInput,
): Promise<GroupDetail> {
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== input.creatorId);
  await assertContacts(db, input.creatorId, memberIds);

  const groupId = randomUUID();
  const roomLocalpart = randomRoomLocalpart();
  let roomCreated = false;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(groups).values({
        id: groupId,
        roomLocalpart,
        title: input.title,
        createdBy: input.creatorId,
      });
      await tx
        .insert(groupMembers)
        .values([
          { groupId, userId: input.creatorId, role: 'owner' },
          ...memberIds.map((userId) => ({ groupId, userId, role: 'member' as const })),
        ]);

      await adminClient.createRoom(roomLocalpart, {
        title: input.title,
        membersOnly: true,
        persistent: true,
        mam: true,
        anonymous: false,
      });
      roomCreated = true;
      await adminClient.setAffiliation(
        roomLocalpart,
        jidFor(localpartFor(input.creatorId), input.domain),
        'owner',
      );
      for (const userId of memberIds) {
        await adminClient.setAffiliation(
          roomLocalpart,
          jidFor(localpartFor(userId), input.domain),
          'member',
        );
      }
    });
  } catch (error) {
    if (roomCreated) {
      await destroyQuietly(adminClient, roomLocalpart);
    }
    throw mapXmppError(error);
  }

  const detail = await getGroupDetail(db, groupId);
  if (!detail) {
    throw new Error('group disappeared right after creation');
  }
  await inviteNewMembers(adminClient, roomLocalpart, memberIds, input.domain, input.logger);
  return detail;
}

export async function getGroupDetail(
  db: ServerDatabase,
  groupId: string,
): Promise<GroupDetail | null> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) {
    return null;
  }
  const members = await listGroupMembers(db, groupId);
  const aiViews = await listGroupAis(db, groupId);
  return {
    id: group.id,
    title: group.title,
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    members,
    ais: aiViews,
  };
}

export async function getMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: GroupRole } | null> {
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function addGroupMembers(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: AddGroupMembersInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can add members');
  }

  const targets = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  await assertContacts(db, input.actorId, targets);

  const existing = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, input.groupId));
  const existingIds = new Set(existing.map((row) => row.userId));
  const toAdd = targets.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    // People and AIs share the same cap.
    const aiRows = await db
      .select({ aiId: groupAis.aiId })
      .from(groupAis)
      .where(eq(groupAis.groupId, input.groupId));
    if (existingIds.size + aiRows.length + toAdd.length > MAX_GROUP_MEMBERS) {
      throw new HttpError(
        400,
        'invalid_request',
        `A group has at most ${MAX_GROUP_MEMBERS} members`,
      );
    }
    try {
      await db.transaction(async (tx) => {
        for (const userId of toAdd) {
          await adminClient.setAffiliation(
            group.roomLocalpart,
            jidFor(localpartFor(userId), input.domain),
            'member',
          );
        }
        await tx
          .insert(groupMembers)
          .values(
            toAdd.map((userId) => ({ groupId: input.groupId, userId, role: 'member' as const })),
          );
      });
    } catch (error) {
      throw mapXmppError(error);
    }
  }

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while adding members');
  }
  await inviteNewMembers(adminClient, group.roomLocalpart, toAdd, input.domain, input.logger);
  return detail;
}

export async function removeGroupMember(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: RemoveGroupMemberInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  const target = await getMembership(db, input.groupId, input.targetUserId);
  if (!target) {
    throw new HttpError(404, 'not_found', 'That user is not a member of this group');
  }

  const isSelf = input.actorId === input.targetUserId;
  if (!isSelf && actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can remove members');
  }
  if (target.role === 'owner') {
    throw new HttpError(403, 'forbidden', 'The owner cannot be removed');
  }

  try {
    await db.transaction(async (tx) => {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(input.targetUserId), input.domain),
        'none',
      );
      await tx
        .delete(groupMembers)
        .where(
          and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.targetUserId)),
        );
    });
  } catch (error) {
    throw mapXmppError(error);
  }

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing a member');
  }
  return detail;
}

// Adds an AI to a group: the actor must own or administer the group and own
// the AI (a foreign AI answers the same 404 as a missing one, so AI ids
// cannot be probed). Adding an AI that is already there is a no-op returning
// the detail. People and AIs share MAX_GROUP_MEMBERS.
export async function addGroupAi(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: AddGroupAiInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can add members');
  }
  const ai = await findOwnedAi(db, input.aiId, input.actorId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }

  const [existing] = await db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(and(eq(groupAis.groupId, input.groupId), eq(groupAis.aiId, input.aiId)))
    .limit(1);
  if (existing) {
    const detail = await getGroupDetail(db, input.groupId);
    if (!detail) {
      throw new Error('group disappeared while adding an AI');
    }
    return detail;
  }
  // A stopped (kill switch) or still-provisioning AI cannot join a room: it
  // would not answer, and a stale membership would surprise the room. An AI
  // that is already a member is left alone by the branch above.
  if (ai.status !== 'active') {
    throw new HttpError(409, 'ai_not_active', 'Resume the AI before adding it to a group');
  }

  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, input.groupId));
  const aiRows = await db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(eq(groupAis.groupId, input.groupId));
  if (memberRows.length + aiRows.length + 1 > MAX_GROUP_MEMBERS) {
    throw new HttpError(400, 'invalid_request', `A group has at most ${MAX_GROUP_MEMBERS} members`);
  }

  try {
    await db.transaction(async (tx) => {
      await adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'member');
      // Two concurrent adds both pass the check above: the loser lands here
      // and still answers 200, keeping the add idempotent.
      await tx
        .insert(groupAis)
        .values({ groupId: input.groupId, aiId: input.aiId, addedBy: input.actorId })
        .onConflictDoNothing({ target: [groupAis.groupId, groupAis.aiId] });
    });
  } catch (error) {
    throw mapXmppError(error);
  }

  emitGroupAi({ type: 'ai-added', groupId: input.groupId, aiId: input.aiId });
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while adding an AI');
  }
  return detail;
}

// Removes an AI from a group: allowed for the AI's owner, or a group owner or
// admin. The AI owner need not still be a group member.
export async function removeGroupAi(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: RemoveGroupAiInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  // Authorize before looking at the group's AIs, so someone who may not
  // remove the AI can't learn whether it is in the group (404 vs 403).
  const [ai] = await db
    .select({ id: ais.id, jid: ais.jid, owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, input.aiId))
    .limit(1);
  const actor = await getMembership(db, input.groupId, input.actorId);
  const isAiOwner = ai !== undefined && ai.owner === input.actorId;
  const isGroupManager = actor !== null && actor.role !== 'member';
  if (!isAiOwner && !isGroupManager) {
    throw new HttpError(
      403,
      'forbidden',
      'Only the AI owner or a group owner or admin can remove it',
    );
  }

  const [membership] = await db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(and(eq(groupAis.groupId, input.groupId), eq(groupAis.aiId, input.aiId)))
    .limit(1);
  if (!membership || !ai) {
    throw new HttpError(404, 'not_found', 'That AI is not in this group');
  }

  try {
    await db.transaction(async (tx) => {
      await adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'none');
      await tx
        .delete(groupAis)
        .where(and(eq(groupAis.groupId, input.groupId), eq(groupAis.aiId, input.aiId)));
    });
  } catch (error) {
    throw mapXmppError(error);
  }

  emitGroupAi({ type: 'ai-removed', groupId: input.groupId, aiId: input.aiId });
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing an AI');
  }
  return detail;
}

// Groups the user belongs to, with the data the chat list needs.
export async function listGroupsForUser(db: ServerDatabase, userId: string): Promise<ChatGroup[]> {
  const memberships = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  if (memberships.length === 0) {
    return [];
  }

  const groupIds = memberships.map((row) => row.groupId);
  const groupRows = await db
    .select({ id: groups.id, roomLocalpart: groups.roomLocalpart, title: groups.title })
    .from(groups)
    .where(inArray(groups.id, groupIds));
  const counts = await db
    .select({ groupId: groupMembers.groupId, total: count() })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds))
    .groupBy(groupMembers.groupId);

  const groupsById = new Map(groupRows.map((row) => [row.id, row]));
  const countsById = new Map(counts.map((row) => [row.groupId, Number(row.total)]));

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
        memberCount: countsById.get(group.id) ?? 0,
        role: membership.role,
      },
    ];
  });
}

async function listGroupMembers(db: ServerDatabase, groupId: string): Promise<GroupMemberView[]> {
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role, name: user.name })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId));

  return rows
    .map((row) => ({ userId: row.userId, name: row.name, role: row.role }))
    .sort(
      (a, b) =>
        ROOM_ROLES[a.role] - ROOM_ROLES[b.role] ||
        a.name.localeCompare(b.name) ||
        a.userId.localeCompare(b.userId),
    );
}

async function listGroupAis(db: ServerDatabase, groupId: string): Promise<GroupAiView[]> {
  const rows = await db
    .select({ aiId: groupAis.aiId, jid: ais.jid, name: ais.name, ownerId: ais.owner })
    .from(groupAis)
    .innerJoin(ais, eq(ais.id, groupAis.aiId))
    .where(eq(groupAis.groupId, groupId));

  return rows
    .map((row) => ({ aiId: row.aiId, jid: row.jid, name: row.name, ownerId: row.ownerId }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.aiId.localeCompare(b.aiId));
}

async function requireGroup(db: ServerDatabase, groupId: string) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  return group;
}

// Every member must already be a contact of the owner. The error is
// deliberately vague: it never says who is not a contact.
async function assertContacts(
  db: ServerDatabase,
  ownerId: string,
  memberIds: string[],
): Promise<void> {
  if (memberIds.length === 0) {
    return;
  }
  const rows = await db
    .select({ id: contacts.contactUserId })
    .from(contacts)
    .where(and(eq(contacts.userId, ownerId), inArray(contacts.contactUserId, memberIds)));
  const known = new Set(rows.map((row) => row.id));
  if (memberIds.some((id) => !known.has(id))) {
    throw new HttpError(403, 'forbidden', 'All members must be your contacts');
  }
}

// A XEP-0249 direct invitation is sent after the member can already join, so
// it is best effort: a failure is logged and never fails the request.
async function inviteNewMembers(
  adminClient: EjabberdAdminClient,
  roomLocalpart: string,
  userIds: string[],
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const users = userIds.map((userId) => jidFor(localpartFor(userId), domain));
  try {
    await adminClient.sendDirectInvitation(roomLocalpart, users);
  } catch (error) {
    logger.warn(
      { err: error, roomLocalpart, members: users.length },
      'could not send the group invitations',
    );
  }
}

function mapXmppError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

async function destroyQuietly(
  adminClient: EjabberdAdminClient,
  roomLocalpart: string,
): Promise<void> {
  try {
    await adminClient.destroyRoom(roomLocalpart);
  } catch {
    // Best effort: the database rows are rolled back either way.
  }
}
