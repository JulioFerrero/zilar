// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import {
  omitUndefined,
  type BackgroundPreset,
  type CreatedInviteLink,
  type DirectoryEntry,
  type GroupAi,
  type GroupBackground,
  type GroupDetail,
  type GroupJoinResult,
  type GroupMember,
  type GroupRole,
  type HandleCheck,
  type InviteLink as GroupInviteLink,
  type JoinPreview,
  type JoinResult,
  type ListenerEagerness,
} from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';
import { checkHandleKind } from './people';

// The group detail schemas live in `@zilar/api-contract` (T-0892). The fields
// older servers omitted stay optional there, so older payloads still parse.
export type { GroupAi, GroupBackground, GroupDetail, GroupMember, ListenerEagerness };

export function createGroup(input: {
  title: string;
  memberIds: string[];
  // T-0124: `channel` creates the broadcast feed (moderated room).
  kind?: 'group' | 'channel';
  // T-0124: the channel's short blurb (≤ 300).
  description?: string;
}): Promise<GroupDetail> {
  // The server trims `title` and `description`; the contract encodes the
  // trimmed form, so the client trims before sending.
  return callApi((client) =>
    client.groups.create({
      payload: {
        ...omitUndefined(input),
        title: input.title.trim(),
        ...(input.description === undefined ? {} : { description: input.description.trim() }),
      },
    }),
  );
}

export function getGroup(groupId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.detail({ params: { id: groupId } }));
}

// T-0054: an owner or admin adds their own AI to a group, and its owner or a
// group manager removes it. Both answer the fresh group detail.
export function addGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.addAi({ params: { id: groupId }, payload: { aiId } }));
}

export function removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.removeAi({ params: { id: groupId, aiId } }));
}

// --- Group roles (T-0116) ---------------------------------------------------
// Custom group roles: labels with two powers (private-topic access and
// approver rights). Reading needs only membership; every write needs a
// group owner/admin.

// The schemas live in `@zilar/api-contract` (T-0892).
export type { GroupRole };

export function listGroupRoles(groupId: string): Promise<GroupRole[]> {
  return callApi((client) => client.roles.list({ params: { id: groupId } })).then(
    ({ roles }) => roles,
  );
}

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createGroupRole(groupId: string, name: string): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.create({ params: { id: groupId }, payload: { name: name.trim() } }),
  );
}

export function renameGroupRole(groupId: string, roleId: string, name: string): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.rename({ params: { id: groupId, roleId }, payload: { name: name.trim() } }),
  );
}

export async function deleteGroupRole(groupId: string, roleId: string): Promise<void> {
  await callApi((client) => client.roles.remove({ params: { id: groupId, roleId } }));
}

export function setGroupRoleMembers(
  groupId: string,
  roleId: string,
  userIds: string[],
): Promise<GroupRole> {
  return callApi((client) =>
    client.roles.setMembers({ params: { id: groupId, roleId }, payload: { userIds } }),
  );
}

// T-0108: the group owner/admin switch for plain members creating topics.
export function setMembersCanCreateTopics(
  groupId: string,
  membersCanCreateTopics: boolean,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: { membersCanCreateTopics } }),
  );
}

export interface SetGroupListenerInput {
  listenerEnabled?: boolean;
  listenerEagerness?: ListenerEagerness;
}

// T-0478: owners/admins turn the group's AI listener on/off and pick an
// eagerness. A member gets 403.
export function setGroupListener(
  groupId: string,
  input: SetGroupListenerInput,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// The patch encoder checks the preset against the contract's list, so an
// unknown id fails as `invalid_request` before any request is sent.
function backgroundPatch(background: GroupBackground) {
  return {
    ...background,
    backgroundPreset: background.backgroundPreset as BackgroundPreset | null,
  };
}

// T-0466: owners and admins set the group's shared background. A member gets
// 403; `null` fields clear them.
export function setGroupBackground(
  groupId: string,
  background: GroupBackground,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({
      params: { id: groupId },
      payload: { background: backgroundPatch(background) },
    }),
  );
}

// --- Channels (T-0124) -------------------------------------------------------
// One-way broadcast feeds: only owner/admins post (the room is moderated and
// subscribers are visitors), everyone else subscribes, reads and mutes. A
// channel is a group with one feed (its General topic): no more topics, and
// the member list is visible to admins only (subscribers see the count).
export function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  return callApi((client) => client.groups.members({ params: { id: groupId } })).then(
    ({ members }) => members,
  );
}

// Only the owner may promote a member to admin (or demote one back). The
// room affiliation follows at once, so a channel's voice mapping is enforced
// by the room. Demoting the last admin answers 409 `channel_needs_admin`.
export function changeGroupMemberRole(
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.changeRole({ params: { id: groupId, userId }, payload: { role } }),
  );
}

export function removeGroupMember(groupId: string, userId: string): Promise<GroupDetail> {
  return callApi((client) => client.groups.removeMember({ params: { id: groupId, userId } }));
}

// --- Group invite links (T-0115) -------------------------------------------
// Shareable links that join a group as `member` (`${WEB}/j/<token>` on the
// web). The token is shown once at creation and never stored — the list
// below carries hints, labels, uses and state, never tokens.
// The schemas live in `@zilar/api-contract` (T-0892).
export type { CreatedInviteLink, GroupInviteLink };

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

// The server trims `label`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createGroupInviteLink(
  groupId: string,
  input: CreateGroupInviteLinkInput = {},
): Promise<CreatedInviteLink> {
  return callApi((client) =>
    client['invite-links'].createLink({
      params: { id: groupId },
      payload: {
        ...omitUndefined(input),
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
      },
    }),
  );
}

export function listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]> {
  return callApi((client) => client['invite-links'].listLinks({ params: { id: groupId } })).then(
    ({ links }) => links,
  );
}

export async function revokeGroupInviteLink(groupId: string, linkId: string): Promise<void> {
  await callApi((client) => client['invite-links'].revokeLink({ params: { id: groupId, linkId } }));
}

// --- Join by link (T-0115) -------------------------------------------------
// The preview names the group and counts its members — never member names,
// and never the group id unless the caller is already a member (they know
// it; the join page opens the group chat with it). Joining adds the caller
// as `member` and returns the group id; an existing member answers
// `alreadyMember: true` without consuming a use.

// T-0124: `channel` previews read "Join channel" (and count subscribers);
// `kind` is absent on older servers = a group.
export type { JoinPreview, JoinResult };

export function previewJoinLink(token: string): Promise<JoinPreview> {
  return callApi((client) => client['invite-links'].preview({ params: { token } }));
}

export function joinByLink(token: string): Promise<JoinResult> {
  return callApi((client) => client['invite-links'].join({ params: { token } }));
}

// --- Public groups and channels (T-0164) -----------------------------------
// A public group or channel holds its own `@handle` (the same namespace as
// `@username`s), appears in the directory, and joins with one tap. A
// private group stays invisible and invite-only, exactly as before.

export type { DirectoryEntry };

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

export interface SearchDirectoryInput {
  q?: string;
  kind?: 'group' | 'channel';
  cursor?: string;
}

export function searchDirectory(input: SearchDirectoryInput = {}): Promise<DirectoryPage> {
  // An empty `q` or `cursor` is left out, like before.
  const query = {
    ...(input.q === undefined || input.q === '' ? {} : { q: input.q }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.cursor === undefined || input.cursor === '' ? {} : { cursor: input.cursor }),
  };
  return callApi((client) => client.directory.search({ query })).then((page) => ({
    entries: [...page.entries],
    next: page.next,
  }));
}

// Exact match of one public group by `@handle` (case-insensitive). A
// private group and an unknown handle answer the same 404.
export function lookupGroupByHandle(handle: string): Promise<DirectoryEntry> {
  return callApi((client) => client.directory.byHandle({ params: { handle } }));
}

export type PublicJoinResult = GroupJoinResult;

// Joins a public group or channel with one request (private or unknown
// answers the same 404; a full group 409 `group_full`; joining twice is
// harmless with `alreadyMember: true`).
export function joinPublicGroup(groupId: string): Promise<PublicJoinResult> {
  return callApi((client) => client.groups.join({ params: { id: groupId } }));
}

// Owner-only: flips a group public (with a handle) or back to private.
// Unique violations map to 409 `handle_taken`; the 14-day interval to 409
// `handle_change_too_soon` with `nextChangeAt` in the error detail.
export function setGroupVisibility(
  groupId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// Live availability of a handle for a public group or channel (the same
// shape, reserved words and uniqueness as `@username`s; the asker's own
// group reservation counts as available).
export function checkGroupHandle(handle: string): Promise<HandleCheck> {
  return checkHandleKind(handle, 'group');
}
