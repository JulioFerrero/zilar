import type { PatchGroupPayload } from '@zilar/api-contract';
import type { MentionMember } from '@zilar/chat-core';

import type { GroupDetail } from '../lib/chat-api';
import type {
  CreatedInviteLink,
  CreateGroupInviteLinkInput,
  GroupInviteLink,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';
import type { CustomGroupRole } from '../lib/roles-api';
import type {
  ApproverRole,
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  TopicPreviewMessage,
  TopicRole,
} from '../lib/topics-api';

export interface ChatStoreGroups {
  /** People as `{ jid: localpart@domain, name, handle? }`, plus the group's AIs. */
  groupMembers: (chatId: string) => MentionMember[];
  groupIdForChat: (chatId: string) => string | undefined;
  /** Private topic names never appear here: the text is fixed. */
  topicNotice: { groupId: string; message: string } | undefined;
  dismissTopicNotice: () => void;
  /** Bumped when a group detail loads so mounted `groupDetail` selectors re-fire. */
  groupDetailsRevision: number;
  /** Group detail keyed by **group id** (not chat id). */
  groupDetail: (groupId: string) => GroupDetail | undefined;
  /** Cached: opening the chat then the group screen costs one GET, not one per mount. */
  ensureGroupDetail: (groupId: string) => void;
  refreshGroupDetail: (groupId: string) => void;
  ownedAis: { id: string; name: string }[];
  /** Returns the new topic's chat id (its room JID). */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  archiveTopic: (chatId: string) => Promise<void>;
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  joinTopic: (chatId: string) => Promise<void>;
  leaveTopic: (chatId: string) => Promise<void>;
  listTopicMembers: (chatId: string) => Promise<{ userId: string; name: string }[]>;
  topicPreview: (chatId: string) => Promise<TopicPreviewMessage[]>;
  listTopicAis: (chatId: string) => Promise<{ id: string; name: string }[]>;
  /** Owner/admin only, same rule as web; never includes tokens. */
  listInviteLinks: (groupId: string) => Promise<GroupInviteLink[]>;
  /** Resolves with the URL (the token) once; the caller shows it and never stores it. */
  createInviteLink: (
    groupId: string,
    input: CreateGroupInviteLinkInput,
  ) => Promise<CreatedInviteLink>;
  revokeInviteLink: (groupId: string, linkId: string) => Promise<void>;
  /** Description ≤ 300. Resolves with the new group id. */
  createChannel: (input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }) => Promise<string>;
  createGroup: (input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }) => Promise<string>;
  leaveChannel: (chatId: string) => Promise<void>;
  transferGroupOwner: (groupId: string, userId: string) => Promise<void>;
  /** Owners only, enforced by the server; a channel's last-admin demotion rejects. */
  changeGroupMemberRole: (
    groupId: string,
    userId: string,
    role: 'admin' | 'member',
  ) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  /** Callers pass only the keys they set; owners/admins only, enforced by the server. */
  patchGroupSettings: (groupId: string, patch: PatchGroupPayload) => Promise<void>;
  addGroupMembers: (groupId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (groupId: string, userId: string) => Promise<void>;
  addGroupAi: (groupId: string, aiId: string) => Promise<void>;
  removeGroupAi: (groupId: string, aiId: string) => Promise<void>;
  /** Subscribers get the owner/admin slice, never the audience. */
  listChannelMembers: (
    groupId: string,
  ) => Promise<{ userId: string; name: string; role: 'owner' | 'admin' | 'member' }[]>;
  /** Owner only; a channel's last-admin demotion rejects. */
  changeChannelRole: (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  previewJoinLink: (token: string) => Promise<JoinPreview>;
  joinByLink: (token: string) => Promise<JoinResult>;
  /** Keyed by **group id**; every member reads it, only owners/admins write it. */
  groupRoles: (groupId: string) => CustomGroupRole[] | undefined;
  refreshGroupRoles: (groupId: string) => Promise<void>;
  createGroupRole: (groupId: string, name: string) => Promise<CustomGroupRole>;
  renameGroupRole: (groupId: string, roleId: string, name: string) => Promise<CustomGroupRole>;
  deleteGroupRole: (groupId: string, roleId: string) => Promise<void>;
  /** The server diffs the full desired member list inside a transaction. */
  setGroupRoleMembers: (
    groupId: string,
    roleId: string,
    userIds: string[],
  ) => Promise<CustomGroupRole>;
  /** Public topics show no role controls; going public clears roles server-side. */
  setTopicRoles: (chatId: string, input: SetTopicRolesInput) => Promise<void>;
  topicRoles: (
    chatId: string,
  ) => { roles: TopicRole[]; approverRole: ApproverRole | null } | undefined;
  refreshTopicRoles: (chatId: string) => Promise<void>;
}
