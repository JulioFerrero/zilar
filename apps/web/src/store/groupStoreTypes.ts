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
  groupMembers: (chatId: string) => MentionMember[];
  groupInfo: (chatId: string) => GroupDetail | undefined;
  refreshGroupInfo: (chatId: string) => void;
  addGroupAi: (chatId: string, aiId: string) => Promise<void>;
  removeGroupAi: (chatId: string, aiId: string) => Promise<void>;
  listMyAis: () => Promise<PublicAi[]>;
  /** The notice shown when the open topic disappeared and the view moved to General;
   *  private topic names never appear in it. */
  topicNotice: { chatId: string; message: string } | undefined;
  dismissTopicNotice: () => void;
  /** Re-reads the chat list (topics included), joining new rooms and moving to General
   *  when the open topic is gone. */
  refreshChats: () => void;
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /** Applies a strip edit (status, owner, link, kind) or a manager edit (name, visibility,
   *  archive) optimistically with rollback on failure. Rejects on failure. */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  joinTopic: (chatId: string) => Promise<void>;
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  setTopicRoles: (chatId: string, input: SetTopicRolesInput) => Promise<void>;
  /** Resolves true when the topic is gone (the caller navigates away), false when it is there. */
  refreshTopicRow: (chatId: string, topicId: string) => Promise<boolean>;
  leaveTopic: (chatId: string) => Promise<void>;
  /** Creates a channel (the broadcast feed: moderated room, only admins post) and opens it;
   *  public with a handle creates its directory entry in one transaction. Rejects on failure. */
  createChannel: (
    title: string,
    memberIds: string[],
    description?: string,
    options?: { visibility?: 'private' | 'public'; handle?: string },
  ) => Promise<string>; /**
  /** Leaves a channel through the member route; admins remove others the same way. */
  leaveChannel: (chatId: string) => Promise<void>;
  /** Promotes a member to admin or demotes one back (owner only). Rejects on failure. */
  changeChannelRole: (chatId: string, userId: string, role: 'admin' | 'member') => Promise<void>;
  addGroupMembers: (chatId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (chatId: string, userId: string) => Promise<void>;
  transferGroupOwner: (chatId: string, userId: string) => Promise<void>;
  /** The owner flips a group public (with a handle) or back to private. Rejects on failure. */
  setGroupVisibility: (
    chatId: string,
    input: { visibility: 'private' | 'public'; handle?: string },
  ) => Promise<void>;
  /** Joins a public group or channel with one request (private or unknown is the same 404)
   *  and returns the General chat id to open. Rejects on failure. */
  joinPublicGroup: (groupId: string) => Promise<string | undefined>;
  setMembersCanCreateTopics: (chatId: string, allowed: boolean) => Promise<void>;
  setGroupBackground: (chatId: string, background: GroupBackground) => Promise<void>;
  setGroupListener: (chatId: string, input: SetGroupListenerInput) => Promise<void>;
}
