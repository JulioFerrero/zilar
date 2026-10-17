import type { MentionMember } from '@zilar/chat-core';
import type {
  CreateTopicInput,
  GroupBackground,
  GroupDetail,
  PatchTopicInput,
  PublicAi,
  SetGroupListenerInput,
  SetTopicRolesInput,
} from '@/lib/api';

export interface ChatStoreGroupApi {
  /** Members of a group chat, loaded from the server on open; empty for DMs. */
  groupMembers: (chatId: string) => MentionMember[];
  /** A group's people and AIs, for the info panel; undefined until loaded. */
  groupInfo: (chatId: string) => GroupDetail | undefined;
  /** Reloads a group's people and AIs (the info panel refreshes when it opens). */
  refreshGroupInfo: (chatId: string) => void;
  /** Adds one of my AIs to the group and refreshes. Rejects on failure. */
  addGroupAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the group and refreshes. Rejects on failure. */
  removeGroupAi: (chatId: string, aiId: string) => Promise<void>;
  /** The AIs I own, for the group panel's add picker. */
  listMyAis: () => Promise<PublicAi[]>;
  /**
   * The short notice shown when the open topic disappeared (made private,
   * archived, or I was removed) and the view moved to General. Cleared
   * when dismissed or when the chat changes. Private topic names never
   * appear in it.
   */
  topicNotice: { chatId: string; message: string } | undefined;
  /** Dismisses the topic notice (or clears a stale one for another chat). */
  dismissTopicNotice: () => void;
  /**
   * Re-reads the chat list from the server (topics included): joins new
   * topic rooms and moves the open view to General when its topic is gone.
   */
  refreshChats: () => void;
  /**
   * Creates a topic in the group that owns `chatId` and opens it. Rejects
   * on failure.
   */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /**
   * Applies a strip edit (status, owner, link, kind) or a manager edit
   * (name, visibility, archive) to the topic that owns `chatId`, updating
   * the row optimistically with rollback on failure. Rejects on failure.
   */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  /** Adds an AI to the topic and refreshes the row. Rejects on failure. */
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the topic and refreshes the row. Rejects on failure. */
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Adds a person to a private topic and refreshes the row. Rejects on failure. */
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  /**
   * T-1786: the caller joins a public topic of the group and refreshes its
   * row. Rejects on failure.
   */
  joinTopic: (chatId: string) => Promise<void>;
  /** Removes a person from a private topic. Rejects on failure. */
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  /**
   * Replaces a private topic's roles and approver role, refreshing the row.
   * Rejects on failure.
   */
  setTopicRoles: (chatId: string, input: SetTopicRolesInput) => Promise<void>;
  /**
   * Re-reads one topic row from the chat list. Resolves true when the topic
   * is gone (archived, made private, or the viewer removed): the caller
   * navigates away. Resolves false when the row is still there.
   */
  refreshTopicRow: (chatId: string, topicId: string) => Promise<boolean>;
  /** Leaves a private topic. Rejects on failure. */
  leaveTopic: (chatId: string) => Promise<void>;
  /**
   * T-0124: creates a channel (the broadcast feed: moderated room, only
   * admins post) and opens it. Rejects on failure.
   * T-0164: `visibility: 'public'` + `handle` creates it with its directory
   * entry in one transaction.
   */
  createChannel: (
    title: string,
    memberIds: string[],
    description?: string,
    options?: { visibility?: 'private' | 'public'; handle?: string },
  ) => Promise<string>; /**
   * T-0124: leaves a channel (subscribers) through the member route. Admins
   * remove others the same way. Rejects on failure.
   */
  leaveChannel: (chatId: string) => Promise<void>;
  /**
   * T-0124: promotes a member to admin (or demotes one back). Owner only;
   * the room affiliation follows at once. Rejects on failure.
   */
  changeChannelRole: (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  addGroupMembers: (chatId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (chatId: string, userId: string) => Promise<void>;
  transferGroupOwner: (chatId: string, userId: string) => Promise<void>;
  /**
   * T-0164: the owner flips a group public (with a handle) or back to
   * private. The detail refreshes from server truth. Rejects on failure.
   */
  setGroupVisibility: (
    chatId: string,
    input: { visibility: 'private' | 'public'; handle?: string },
  ) => Promise<void>;
  /**
   * T-0164: joins a public group or channel with one request (private or
   * unknown answers the same 404). Refreshes the list and returns the
   * General chat id to open, like the link join. Rejects on failure.
   */
  joinPublicGroup: (groupId: string) => Promise<string | undefined>;
  /** Flips the group's "members can create topics" switch. Rejects on failure. */
  setMembersCanCreateTopics: (chatId: string, allowed: boolean) => Promise<void>;
  /** T-0466: sets or clears the group's shared background (owner/admin). */
  setGroupBackground: (chatId: string, background: GroupBackground) => Promise<void>;
  /** T-0478: turns the group's AI listener on/off or sets its eagerness (owner/admin). */
  setGroupListener: (chatId: string, input: SetGroupListenerInput) => Promise<void>;
}
