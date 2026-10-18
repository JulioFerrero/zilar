// effect-plain: promise edge over callApi; the shared calls live in @zilar/client-core.
import {
  omitUndefined,
  type BackgroundPreset,
  type DirectoryEntry,
  type GroupBackground,
  type GroupDetail,
  type GroupJoinResult,
  type HandleCheck,
  type ListenerEagerness,
} from '@zilar/api-contract';
import { makeGroupsApi, type CreateGroupInviteLinkInput } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';
import { checkHandleKind } from './people';

// Fields older servers omitted stay optional, so their payloads still parse.
export type {
  CreatedInviteLink,
  GroupAi,
  GroupBackground,
  GroupDetail,
  GroupMember,
  GroupRole,
  InviteLink as GroupInviteLink,
  JoinPreview,
  JoinResult,
  ListenerEagerness,
} from '@zilar/api-contract';
export type { CreateGroupInviteLinkInput };

const api = makeGroupsApi(callApi);
export const {
  addGroupAi,
  addGroupMembers,
  changeGroupMemberRole,
  createGroupInviteLink,
  createGroupRole,
  deleteGroup,
  deleteGroupRole,
  getGroup,
  joinByLink,
  listGroupInviteLinks,
  listGroupMembers,
  listGroupRoles,
  previewJoinLink,
  removeGroupAi,
  removeGroupMember,
  renameGroupRole,
  revokeGroupInviteLink,
  setGroupRoleMembers,
  transferGroupOwner,
} = api;

export function createGroup(input: {
  title: string;
  memberIds: string[];
  // channel creates the broadcast feed (moderated room).
  kind?: 'group' | 'channel';
  // The channel's short blurb (≤ 300).
  description?: string;
}): Promise<GroupDetail> {
  // The contract encodes the trimmed form, so the client trims before sending.
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

// Owners and admins switch whether plain members may create topics.
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

// Owner/admin only; a member gets 403.
export function setGroupListener(
  groupId: string,
  input: SetGroupListenerInput,
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// An unknown preset fails as invalid_request before any request is sent.
function backgroundPatch(background: GroupBackground) {
  return {
    ...background,
    backgroundPreset: background.backgroundPreset as BackgroundPreset | null,
  };
}

// Owner/admin only; a member gets 403, and null fields clear them.
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

// A public group or channel holds its own @handle in the username namespace and joins
// with one tap; a private group stays invisible and invite-only.

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

// Exact match, case-insensitive; a private group and an unknown handle answer the same 404.
export function lookupGroupByHandle(handle: string): Promise<DirectoryEntry> {
  return callApi((client) => client.directory.byHandle({ params: { handle } }));
}

export type PublicJoinResult = GroupJoinResult;

// Private or unknown answers the same 404, a full group 409 group_full; joining twice is harmless.
export function joinPublicGroup(groupId: string): Promise<PublicJoinResult> {
  return callApi((client) => client.groups.join({ params: { id: groupId } }));
}

// Owner-only. Unique violations map to 409 handle_taken; the 14-day interval to 409
// handle_change_too_soon with nextChangeAt in the error detail.
export function setGroupVisibility(
  groupId: string,
  input: { visibility: 'private' | 'public'; handle?: string },
): Promise<GroupDetail> {
  return callApi((client) =>
    client.groups.patch({ params: { id: groupId }, payload: omitUndefined(input) }),
  );
}

// Live availability, with the same reserved words and uniqueness as usernames; the asker's
// own group reservation counts as available.
export function checkGroupHandle(handle: string): Promise<HandleCheck> {
  return checkHandleKind(handle, 'group');
}
