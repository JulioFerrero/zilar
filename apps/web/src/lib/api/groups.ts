// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
// The calls shared with the phone live in `@zilar/client-core`
// (`groups-api.ts`, T-2056), over `callApi`; this module keeps the names and
// types web has always imported, plus the web-only calls.
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

// The group detail schemas live in `@zilar/api-contract` (T-0892). The fields
// older servers omitted stay optional there, so older payloads still parse.
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
