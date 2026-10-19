// effect-plain: promise edge over callApi; the shared calls live in @zilar/client-core.
import {
  omitUndefined,
  type BackgroundPreset,
  type GroupBackground,
  type GroupDetail,
  type ListenerEagerness,
} from '@zilar/api-contract';
import {
  makeDirectoryApi,
  makeGroupsApi,
  type CreateGroupInviteLinkInput,
} from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

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
  createGroup,
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

export type {
  DirectoryEntry,
  DirectoryPage,
  PublicJoinResult,
  SearchDirectoryInput,
} from '@zilar/client-core';

const directory = makeDirectoryApi(callApi);
export const {
  searchDirectory,
  lookupGroupByHandle,
  joinPublicGroup,
  setGroupVisibility,
  checkGroupHandle,
} = directory;
