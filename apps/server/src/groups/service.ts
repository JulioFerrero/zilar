import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, eq, inArray } from 'drizzle-orm';
import { findOwnedAi } from '../ais/service';
import type { ServerDatabase } from '../db/client';
import {
  ais,
  contacts,
  groupAis,
  groupMembers,
  groups,
  topicAis,
  topicMembers,
  topics,
  user,
} from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { emitGroupAi, emitTopicAi } from './events';
import { aiMayBeInTopic } from '../topics/access';
import { recordAudit, type AuditRecorder } from '../audit/service';
import { dropMemberRoles, roleHoldersByGroup, topicRoleHolderIds } from '../roles/service';
import { revokeActiveRulesForAiInGroup } from '../approvals/rules';
import { deleteRoutinesForAiInGroup } from '../routines/service';
import { deleteToolsForAiInGroup } from '../tools/service';
import { syncTopicRoom } from '../topics/rooms';

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
  /** T-0116: the custom group roles this member holds. */
  roles: Array<{ id: string; name: string }>;
}

export type ChannelKind = 'group' | 'channel';

export interface GroupDetail {
  id: string;
  title: string;
  createdBy: string;
  createdAt: Date;
  membersCanCreateTopics: boolean;
  // T-0124: `group` behaves as before; `channel` is the broadcast feed (its
  // General topic is the feed; no more topics; posting is voice-gated by the
  // moderated room). Optional in older payloads = `group`.
  kind: ChannelKind;
  // T-0124: the channel's short blurb, or null when none.
  description: string | null;
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
  kind: ChannelKind;
  description: string | null;
}

export interface CreateGroupInput {
  creatorId: string;
  title: string;
  memberIds: string[];
  domain: string;
  logger: InviteLogger;
  // T-0124: `channel` creates the broadcast feed (moderated room, owner +
  // admins post). `group` (default) behaves as before. A description (≤ 300)
  // is accepted for both and stored on the row.
  kind?: ChannelKind | undefined;
  description?: string | undefined;
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
  logger: InviteLogger;
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
  domain: string;
  logger: InviteLogger;
}

export interface PatchGroupInput {
  groupId: string;
  actorId: string;
  membersCanCreateTopics?: boolean | undefined;
}

// T-0108: group owner/admin toggles whether plain members may create topics.
export async function patchGroup(db: ServerDatabase, input: PatchGroupInput): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  // A non-member sees the same 404 as a missing group.
  if (!group || !actor) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can change group settings');
  }
  if (input.membersCanCreateTopics !== undefined) {
    await db
      .update(groups)
      .set({ membersCanCreateTopics: input.membersCanCreateTopics })
      .where(eq(groups.id, input.groupId));
  }
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while patching it');
  }
  return detail;
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
  const kind: ChannelKind = input.kind ?? 'group';
  const description = input.description?.trim() === '' ? null : (input.description ?? null);

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
        kind,
        description,
      });
      await tx
        .insert(groupMembers)
        .values([
          { groupId, userId: input.creatorId, role: 'owner' },
          ...memberIds.map((userId) => ({ groupId, userId, role: 'member' as const })),
        ]);
      // T-0108: the group's room becomes its General topic (same room, same
      // history). The row is created in the same transaction as the group.
      // T-0124: a channel's General topic is its only topic — the feed.
      await tx.insert(topics).values({
        id: randomUUID(),
        groupId,
        name: 'General',
        glyph: 'G',
        roomLocalpart,
        visibility: 'public',
        kind: 'chat',
        status: 'open',
        isGeneral: true,
        createdBy: input.creatorId,
      });

      // T-0124: a channel's room is moderated with `members_by_default:
      // false`, so subscribers (affiliation `member`) join as visitors:
      // they read but cannot post. Affiliations `admin`/`owner` carry voice,
      // so admins and the owner post. Group rooms stay unmoderated with the
      // ejabberd default, so every member keeps voice.
      await adminClient.createRoom(roomLocalpart, {
        title: input.title,
        membersOnly: true,
        persistent: true,
        mam: true,
        anonymous: false,
        ...(kind === 'channel' ? { moderated: true, membersByDefault: false } : {}),
      });
      roomCreated = true;
      await adminClient.setAffiliation(
        roomLocalpart,
        jidFor(localpartFor(input.creatorId), input.domain),
        'owner',
      );
      for (const userId of memberIds) {
        // T-0124: in a moderated channel room only affiliations admin/owner
        // carry voice, so every initial member joins as a voice-less member
        // (a visitor once they enter). Group rooms keep `member` for all.
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
    membersCanCreateTopics: group.membersCanCreateTopics,
    kind: group.kind,
    description: group.description,
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
    // T-0108: public topics gain the new members. The sync is best effort —
    // the members are in the database even if a room call fails (the failure
    // is logged with the group id, never a topic name).
    await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
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
  // T-0124: a channel always keeps its admins' voice (the room is moderated,
  // so only affiliation admin/owner may post). Demoting the last admin would
  // silence the feed: the demotion itself is refused (see
  // `changeMemberRole`), and removing the last admin is refused here.
  if (group.kind === 'channel' && !isSelf) {
    await assertChannelKeepsAnAdmin(db, input.groupId, input.targetUserId);
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
      // T-0108: a removed person loses their private-topic rows too. The
      // topic room sync below then drops them from every topic room.
      const topicRows = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.groupId, input.groupId));
      const privateIds = topicRows.map((row) => row.id);
      if (privateIds.length > 0) {
        await tx
          .delete(topicMembers)
          .where(
            and(
              inArray(topicMembers.topicId, privateIds),
              eq(topicMembers.userId, input.targetUserId),
            ),
          );
      }
    });
  } catch (error) {
    throw mapXmppError(error);
  }
  // T-0116: leaving the group drops the member's role rows, and the topics
  // they reached only through a role re-sync. Best effort after the commit,
  // like the room syncs above. The dropped rows are audited as
  // `group.role_unassigned` (ids only) so the log keeps who-held-what;
  // a failed audit write is logged and never thrown. The audit rows for a
  // private topic never carry its name either.
  const droppedRoleIds = await dropMemberRoles(
    {
      db,
      adminClient,
      domain: input.domain,
      logger: input.logger,
    },
    input.groupId,
    input.targetUserId,
  );
  for (const roleId of droppedRoleIds) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.role_unassigned',
          subjectId: roleId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { groupId: input.groupId, subjectUserId: input.targetUserId },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a role loss on leave');
    }
  }
  // T-0108: public topics lose the person; private topics drop them when
  // their row is gone. Best effort after the database commit: a failure is
  // logged with the group id (never a topic name), never thrown. The sync
  // also drops AIs whose owner just lost visibility of a private topic
  // (derived rule in `topics/rooms.ts`); the event loop below tells live
  // gateway sessions to leave those rooms right away.
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  await emitDroppedGroupTopicAis(db, input.groupId);
  await archiveDrainedPrivateTopics(db, input.groupId);

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing a member');
  }
  return detail;
}

export interface ChangeMemberRoleInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  role: 'admin' | 'member';
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

// Promotes a member to admin (or demotes an admin back to member). Only the
// owner may change roles. The room affiliation follows the role at once: in
// a channel's moderated room an admin gains voice (affiliation `admin`) and
// a demoted admin loses it (`member` again), so the posting rule is enforced
// by the room, not by the UI. Demoting the channel's last admin is refused
// (`channel_needs_admin`), so the feed can never fall silent.
export async function changeMemberRole(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: ChangeMemberRoleInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!group || !actor) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (actor.role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Only the owner can change member roles');
  }
  const target = await getMembership(db, input.groupId, input.targetUserId);
  if (!target) {
    throw new HttpError(404, 'not_found', 'That user is not a member of this group');
  }
  if (target.role === 'owner') {
    throw new HttpError(403, 'forbidden', 'The owner cannot be demoted');
  }
  if (input.targetUserId === input.actorId) {
    throw new HttpError(403, 'forbidden', 'The owner cannot change their own role');
  }
  if (target.role === input.role) {
    const detail = await getGroupDetail(db, input.groupId);
    if (!detail) {
      throw new Error('group disappeared while changing a member role');
    }
    return detail;
  }
  if (input.role === 'member' && group.kind === 'channel') {
    await assertChannelKeepsAnAdmin(db, input.groupId, input.targetUserId);
  }
  try {
    await db.transaction(async (tx) => {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(input.targetUserId), input.domain),
        input.role,
      );
      await tx
        .update(groupMembers)
        .set({ role: input.role })
        .where(
          and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.userId, input.targetUserId)),
        );
    });
  } catch (error) {
    throw mapXmppError(error);
  }
  // T-0124: every promote/demote is audited as `group.role_changed` (ids and
  // roles only — never names). The recorder is injected by the route; a write
  // failure is logged and never fails the request.
  if (input.audit) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.role_changed',
          subjectId: input.targetUserId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: {
            groupId: input.groupId,
            subjectUserId: input.targetUserId,
            from: target.role,
            to: input.role,
          },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a role change');
    }
  }
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while changing a member role');
  }
  return detail;
}

// A channel refuses to lose its last admin voice: after the change, at
// least one admin besides the target must remain (the owner always counts,
// so demoting the only admin while the owner stays is refused — the feed
// must keep someone with voice besides the owner). Answers 409
// `channel_needs_admin`. The check and the write are not atomic (same known
// race as the group cap); two concurrent demotions can both pass — the next
// write heals the invariant by refusing again.
async function assertChannelKeepsAnAdmin(
  db: ServerDatabase,
  groupId: string,
  losingUserId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const adminsLeft = rows.some((row) => row.userId !== losingUserId && row.role === 'admin');
  if (!adminsLeft) {
    throw new HttpError(
      409,
      'channel_needs_admin',
      'A channel needs at least one admin besides the owner',
    );
  }
}

// The member list a viewer may see: admins see everyone, like in a group;
// a channel subscriber sees nobody (the count rides the chat/group detail
// instead). The rows are sorted like `listGroupMembers`. Never 404s for a
// member: the route answers the (possibly empty) list, so subscribers can
// tell "hidden" from "gone" by the group detail they already hold.
export async function listMembersForViewer(
  db: ServerDatabase,
  groupId: string,
  viewerId: string,
): Promise<{ members: GroupMemberView[]; isAdmin: boolean }> {
  const viewer = await getMembership(db, groupId, viewerId);
  if (!viewer) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const isAdmin = viewer.role === 'owner' || viewer.role === 'admin';
  if (group.kind === 'channel' && !isAdmin) {
    return { members: [], isAdmin };
  }
  return { members: await listGroupMembers(db, groupId), isAdmin };
}

// After a role change outside `changeMemberRole` (none exists today) or a
// drifted room, this re-applies the voice mapping of a channel room: every
// owner/admin holds affiliation admin/owner, every subscriber `member`.
// A group room is left untouched. Best effort: failures are logged with the
// group id (never member names) and never thrown.
export async function syncChannelVoice(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group || group.kind !== 'channel') {
    return;
  }
  const rows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  for (const row of rows) {
    const wanted: 'owner' | 'admin' | 'member' =
      row.role === 'owner' ? 'owner' : row.role === 'admin' ? 'admin' : 'member';
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(row.userId), domain),
        wanted,
      );
    } catch {
      logger.warn({ groupId }, 'could not sync the channel voice');
    }
  }
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
      // T-0109: removing the AI from the group removes it from every topic
      // of that group. The rows are deleted in the same transaction as the
      // rules/tools cleanup below; every non-General topic room is re-synced
      // after the commit (the gateway leaves through the same event).
      const topicRows = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.groupId, input.groupId));
      const topicIds = topicRows.map((row) => row.id);
      if (topicIds.length > 0) {
        await tx
          .delete(topicAis)
          .where(and(inArray(topicAis.topicId, topicIds), eq(topicAis.aiId, input.aiId)));
      }
      // T-0099: an "always" rule tied to this (AI, group) pair must
      // die with the membership. Personal rules and other-group rules
      // are unaffected. `now` is the same timestamp the admin client
      // saw for the affiliation change so audit rows line up.
      await revokeActiveRulesForAiInGroup(tx as unknown as ServerDatabase, {
        aiId: input.aiId,
        groupId: input.groupId,
        actorId: input.actorId,
        now: new Date(),
      });
      // T-0103: the AI's tools made in this group die with the
      // membership, like the rules above. Personal-chat tools and
      // other-group tools are unaffected.
      await deleteToolsForAiInGroup(tx as unknown as ServerDatabase, {
        aiId: input.aiId,
        groupId: input.groupId,
        now: new Date(),
      });
      // T-0104: the AI's routines in this group die with the membership
      // too, next to the tools above.
      await deleteRoutinesForAiInGroup(tx as unknown as ServerDatabase, {
        aiId: input.aiId,
        groupId: input.groupId,
        now: new Date(),
      });
    });
  } catch (error) {
    throw mapXmppError(error);
  }

  // Every topic room of the group where the AI had a row loses it. Best
  // effort after the commit, like the member flows: a failure is logged with
  // the group id (never a topic name), never thrown.
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
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
    .select({
      id: groups.id,
      roomLocalpart: groups.roomLocalpart,
      title: groups.title,
      kind: groups.kind,
      description: groups.description,
    })
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
        kind: group.kind,
        description: group.description,
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

  // T-0116: fold each member's custom roles into the same row. Role
  // membership is not secret: every group member sees the same list.
  const byUser = await roleHoldersByGroup(db, groupId);
  return rows
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      role: row.role,
      roles: byUser.get(row.userId) ?? [],
    }))
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

// T-0108: re-apply the desired members to every active topic room of the
// group (public topics gain/lose the person; private topics drop anyone
// whose `topic_members` row is gone). Best effort: the database is the
// source of truth, and a failed room call is logged with the group id
// (never a topic name), never thrown, so the group flow that just committed
// is not rolled back by a room hiccup.
async function syncGroupTopicRooms(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const rows = await db.select().from(topics).where(eq(topics.groupId, groupId));
  for (const topic of rows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    try {
      await syncTopicRoom({ db, adminClient, domain, logger }, topic);
    } catch {
      logger.warn({ groupId }, 'could not sync a topic room after a group membership change');
    }
  }
}

// T-0109: after a group membership change, every AI that the derived rule
// (`aiMayBeInTopic`) no longer allows in a topic gets an `ai-removed` event
// so a live gateway session leaves the room without waiting for reconcile.
// The `topic_ais` rows stay: re-adding the owner brings the AI back.
async function emitDroppedGroupTopicAis(db: ServerDatabase, groupId: string): Promise<void> {
  const topicRows = await db.select().from(topics).where(eq(topics.groupId, groupId));
  for (const topic of topicRows) {
    if (topic.isGeneral || topic.archivedAt !== null || topic.visibility !== 'private') {
      continue;
    }
    const aiRows = await db
      .select({ aiId: topicAis.aiId, owner: ais.owner, status: ais.status })
      .from(topicAis)
      .innerJoin(ais, eq(ais.id, topicAis.aiId))
      .where(eq(topicAis.topicId, topic.id));
    for (const row of aiRows) {
      const allowed = await aiMayBeInTopic(db, topic, {
        id: row.aiId,
        owner: row.owner,
        status: row.status,
      });
      if (!allowed) {
        emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId: row.aiId });
      }
    }
  }
}

// T-0108: a private topic with no members left is archived. T-0116: role
// holders count as members — a topic a role still grants access to stays
// alive even with zero direct rows.
async function archiveDrainedPrivateTopics(db: ServerDatabase, groupId: string): Promise<void> {
  const rows = await db.select().from(topics).where(eq(topics.groupId, groupId));
  for (const topic of rows) {
    if (topic.archivedAt !== null || topic.visibility !== 'private' || topic.isGeneral) {
      continue;
    }
    const [row] = await db
      .select({ total: count() })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topic.id));
    if (Number(row?.total ?? 0) !== 0) {
      continue;
    }
    const holders = await topicRoleHolderIds(db, topic.id, groupId);
    if (holders.size === 0) {
      await db
        .update(topics)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(topics.id, topic.id));
    }
  }
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
