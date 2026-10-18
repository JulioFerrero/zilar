// The port interfaces of the web chat store: one ApiClient method per API call and the
// storage surface; ports.ts re-exports both types.
import type {
  ChatEntry,
  ChatPref,
  ChatBackgroundChoice,
  Contact,
  CreateGroupInviteLinkInput,
  CreatedInviteLink,
  CreateTopicInput,
  DirectoryEntry,
  DirectoryPage,
  GroupBackground,
  GroupDetail,
  GroupInviteLink,
  GroupMember,
  Invite,
  JoinPreview,
  JoinResult,
  ListChatMediaInput,
  Me,
  MediaPage,
  PatchTopicInput,
  Pin,
  PinMessageInput,
  PublicAi,
  PublicJoinResult,
  PutChatPrefInput,
  Topic,
  TopicAi,
  TopicMember,
  SetGroupListenerInput,
  SetTopicRolesInput,
  XmppToken,
} from '@/lib/api';

export interface ApiClient {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  /** Stores the caller's read mark; the id must be numeric. Optional so fakes keep working. */
  markChatRead?(jid: string, messageId: string): Promise<void>;
  /** Confirms the device holds these origin ids, 1 to 50 per call. Optional for fakes. */
  markChatDelivered?(jid: string, originIds: string[]): Promise<void>;
  /** Deletes one message from the caller's own copy of a DM. Optional so fakes keep working. */
  deleteMessageForMe?(jid: string, archiveId: string): Promise<void>;
  clearChatHistory?(jid: string): Promise<void>;
  createGroup(input: {
    title: string;
    memberIds: string[];
    kind?: 'group' | 'channel';
    description?: string;
    // public creates the group with a handle in one transaction.
    visibility?: 'private' | 'public';
    handle?: string;
  }): Promise<GroupDetail>;
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  // Public visibility with a handle, the Explore search, the exact lookup and the one-tap join.
  setGroupVisibility(
    groupId: string,
    input: { visibility: 'private' | 'public'; handle?: string },
  ): Promise<GroupDetail>;
  searchDirectory(input: {
    q?: string;
    kind?: 'group' | 'channel';
    cursor?: string;
  }): Promise<DirectoryPage>;
  lookupGroupByHandle(handle: string): Promise<DirectoryEntry>;
  joinPublicGroup(groupId: string): Promise<PublicJoinResult>;
  createInvite(): Promise<Invite>;
  createGroupInviteLink(
    groupId: string,
    input: CreateGroupInviteLinkInput,
  ): Promise<CreatedInviteLink>;
  listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]>;
  revokeGroupInviteLink(groupId: string, linkId: string): Promise<void>;
  previewJoinLink(token: string): Promise<JoinPreview>;
  joinByLink(token: string): Promise<JoinResult>;
  changeGroupMemberRole(
    groupId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<GroupDetail>;
  removeGroupMember(groupId: string, userId: string): Promise<GroupDetail>;
  listAis(): Promise<PublicAi[]>;
  addGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
  removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
  createTopic(groupId: string, input: CreateTopicInput): Promise<Topic>;
  getTopic(topicId: string): Promise<Topic>;
  patchTopic(topicId: string, input: PatchTopicInput): Promise<Topic>;
  archiveTopic(topicId: string): Promise<Topic>;
  listGroupTopics(groupId: string): Promise<Topic[]>;
  listTopicMembers(topicId: string): Promise<TopicMember[]>;
  addTopicMember(topicId: string, userId: string): Promise<Topic>;
  removeTopicMember(topicId: string, userId: string): Promise<Topic>;
  joinTopic(topicId: string): Promise<Topic>;
  listTopicAis(topicId: string): Promise<TopicAi[]>;
  addTopicAi(topicId: string, aiId: string): Promise<Topic>;
  removeTopicAi(topicId: string, aiId: string): Promise<Topic>;
  setTopicRoles(topicId: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<GroupDetail>;
  setGroupBackground(groupId: string, background: GroupBackground): Promise<GroupDetail>;
  setGroupListener(groupId: string, input: SetGroupListenerInput): Promise<GroupDetail>;
  listChatPrefs(): Promise<ChatPref[]>;
  getChatBackgroundDefault(): Promise<ChatBackgroundChoice>;
  putChatBackgroundDefault(input: ChatBackgroundChoice): Promise<ChatBackgroundChoice>;
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
  listPins(chat: string): Promise<Pin[]>;
  listChatMedia(input: ListChatMediaInput): Promise<MediaPage>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<void>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
