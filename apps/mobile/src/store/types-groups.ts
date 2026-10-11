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
  TopicRole,
} from '../lib/topics-api';

/**
 * The group, channel, topic, invite and role slice of `ChatStoreState`, split
 * out by T-1095 to keep `types.ts` under 400 lines. Member names, types and
 * doc comments are unchanged; `ChatStoreState` extends this interface.
 */
export interface ChatStoreGroups {
  /**
   * The members and AIs of the group behind one chat row (T-0227, the mobile
   * twin of web's `groupMembers`): people as `{ jid: localpart@domain, name,
   * handle? }` plus the group's AIs as `{ jid, name }`. Empty for DMs and
   * when no group detail is cached yet.
   */
  groupMembers: (chatId: string) => MentionMember[];
  /**
   * The group id behind one chat row (T-0227, the mobile twin of the web
   * row's group id): topic rows carry it directly, legacy group rows
   * resolve it through the remembered `/api/chats` entries. Undefined for
   * DMs and unknown chats. The chat screen subscribes its mention memo
   * through it so a cold open re-resolves members when the detail lands.
   */
  groupIdForChat: (chatId: string) => string | undefined;
  /**
   * The short notice shown when the open topic disappeared (made private,
   * archived, or I was removed) and the view moved to the topics screen.
   * Private topic names never appear here: the text is fixed.
   */
  topicNotice: { groupId: string; message: string } | undefined;
  /** Dismisses the topic notice (or clears a stale one for another group). */
  dismissTopicNotice: () => void;
  /**
   * Bumped every time a group detail finishes loading, so `groupDetail`
   * selectors re-fire for screens mounted before the fetch resolved.
   */
  groupDetailsRevision: number;
  /**
   * The group detail (people + roles + AIs) of one group, keyed by **group
   * id** (not chat id): the topics screen passes its route param straight
   * through. `undefined` until `refreshGroupDetail` has loaded it.
   */
  groupDetail: (groupId: string) => GroupDetail | undefined;
  /**
   * Loads the group detail of one group id (people + roles + AIs), unless a
   * fresh detail is already cached or a load is in flight. Mount effects use
   * this (T-0139): opening the chat and then the group screen costs one GET,
   * not one per mount. `refreshGroupDetail` forces instead.
   */
  ensureGroupDetail: (groupId: string) => void;
  /** Reloads the group detail of one group id, even when cached. Use for an
   *  explicit user refresh or after a write that changes the group. */
  refreshGroupDetail: (groupId: string) => void;
  /** The AIs the viewer owns, for the new-topic sheet's unticked list. */
  ownedAis: { id: string; name: string }[];
  /**
   * Creates a topic in the group that owns `chatId` and opens it. Rejects on
   * failure. Returns the new topic's chat id (its room JID).
   */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /**
   * Patches the topic that owns `chatId` (status, owner, link, visibility,
   * archive), updating the row. Rejects on failure.
   */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  /** Archives the topic that owns `chatId`. Rejects on failure. */
  archiveTopic: (chatId: string) => Promise<void>;
  /** Adds an AI to the topic and refreshes the row. Rejects on failure. */
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the topic and refreshes the row. Rejects on failure. */
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Adds a person to a private topic and refreshes the row. Rejects on failure. */
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Removes a person from a private topic. Rejects on failure. */
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Leaves a private topic. Rejects on failure. */
  leaveTopic: (chatId: string) => Promise<void>;
  /** Reads the members of a private topic (public topics read the group). */
  listTopicMembers: (chatId: string) => Promise<{ userId: string; name: string }[]>;
  /** Reads the AIs in a topic. */
  listTopicAis: (chatId: string) => Promise<{ id: string; name: string }[]>;
  /**
   * The active invite links of one group (owner/admin only, same rule as
   * web): hints, labels, uses and state — never tokens (T-0136). Rejects on
   * failure.
   */
  listInviteLinks: (groupId: string) => Promise<GroupInviteLink[]>;
  /**
   * Creates an invite link for one group. Resolves with the link shown once
   * (the URL carries the token); the caller shows it and never stores it.
   */
  createInviteLink: (
    groupId: string,
    input: CreateGroupInviteLinkInput,
  ) => Promise<CreatedInviteLink>;
  /** Revokes an invite link. Idempotent; rejects on failure. */
  revokeInviteLink: (groupId: string, linkId: string) => Promise<void>;
  /**
   * Creates a channel (T-0144, title + optional description ≤ 300) and
   * refreshes the chat list. Resolves with the new group id. Rejects on
   * failure.
   */
  createChannel: (input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }) => Promise<string>;
  /**
   * Creates a group (T-0214, title + member ids) and refreshes the
   * chat list. Resolves with the new group id. Rejects on failure.
   */
  createGroup: (input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }) => Promise<string>;
  /**
   * Leaves a channel (T-0144): removes the caller through the member route
   * and refreshes the chat list. Rejects on failure.
   */
  leaveChannel: (chatId: string) => Promise<void>;
  /**
   * Reads the members slice for one group (T-0144): the full audience for
   * owners/admins, the owner/admins slice for channel subscribers (never the
   * audience). Rejects on failure.
   */
  listChannelMembers: (
    groupId: string,
  ) => Promise<{ userId: string; name: string; role: 'owner' | 'admin' | 'member' }[]>;
  /**
   * Promotes a subscriber to admin or demotes one back (T-0144, owner only,
   * channels only). Refreshes the detail and the chat list, so the acting
   * device's rows (myRole, counts) match server truth and the composer bar
   * flips. The last-admin demotion rejects. Rejects on failure.
   */
  changeChannelRole: (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  /** Previews a join-by-link token: group title and member count only. */
  previewJoinLink: (token: string) => Promise<JoinPreview>;
  /**
   * Joins the group behind a link token as `member` and refreshes the chat
   * list. Resolves with the group id. Rejects on failure.
   */
  joinByLink: (token: string) => Promise<JoinResult>;
  /**
   * The custom roles of one group (T-0137), keyed by **group id** like the
   * group detail. `undefined` until `refreshGroupRoles` has loaded them;
   * every member reads the list, only owners/admins write it.
   */
  groupRoles: (groupId: string) => CustomGroupRole[] | undefined;
  /** Loads the custom roles of one group id. Rejects on failure. */
  refreshGroupRoles: (groupId: string) => Promise<void>;
  /** Creates a role in `groupId` (the screen passes its route param, so an
   *  empty group with no loaded topic rows still works). Rejects on failure. */
  createGroupRole: (groupId: string, name: string) => Promise<CustomGroupRole>;
  /** Renames a role in `groupId`. Rejects on failure. */
  renameGroupRole: (groupId: string, roleId: string, name: string) => Promise<CustomGroupRole>;
  /** Deletes a role in `groupId` everywhere. Rejects on failure. */
  deleteGroupRole: (groupId: string, roleId: string) => Promise<void>;
  /**
   * Replaces a role's holder set in `groupId` (the server diffs inside a
   * transaction, so the full desired member list goes over the wire).
   * Rejects on failure.
   */
  setGroupRoleMembers: (
    groupId: string,
    roleId: string,
    userIds: string[],
  ) => Promise<CustomGroupRole>;
  /**
   * Replaces a private topic's roles and picks its approver role,
   * refreshing the row. Public topics show no role controls. Going public
   * clears roles server-side, so the refreshed row carries none. Rejects on
   * failure.
   */
  setTopicRoles: (chatId: string, input: SetTopicRolesInput) => Promise<void>;
  /**
   * The roles attached to the topic that owns `chatId` plus its approver
   * role (T-0137). `undefined` until `refreshTopicRoles` has loaded them.
   */
  topicRoles: (
    chatId: string,
  ) => { roles: TopicRole[]; approverRole: ApproverRole | null } | undefined;
  /** Loads the attached roles + approver role of the topic. Rejects on failure. */
  refreshTopicRoles: (chatId: string) => Promise<void>;
}
