import type { AlbumRef, ChatFolder, MentionMember, ReplyRef } from '@zilar/chat-core';
import type {
  ChatStoreActions,
  ChatStoreCommonState,
  DeleteOutcome,
  HistoryLoad,
  SendStickerInput,
  SendTextOptions,
} from '@zilar/client-core/store';
import type { PatchGroupPayload } from '@zilar/api-contract';

import type { Me, GroupDetail } from '../lib/chat-api';
import type { PickedFile } from '../lib/attachment-ports';
import type { PutChatPrefInput } from '../lib/chat-prefs-api';
import type { CreateChatFolderInput, PatchChatFolderInput } from '../lib/chat-folders-api';
import type { Pin } from '../lib/pins-api';
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

export type {
  ConnectionStatus,
  DraftState,
  SendTextOptions,
  TypingState,
} from '@zilar/client-core/store';
export type SendStickerChoice = SendStickerInput;

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

/** "empty" is not a load state: it is what a finished load with no rows looks like. */
export type LoadState = 'loading' | 'loaded' | 'error';

/** A message that finished a draft keeps the draft's `draft-<turnId>` key, so the bubble is reused and its reveal carries over instead of snapping in. */
export function draftEntryKey(
  messageId: string,
  finishedDraftMessages: Record<string, string>,
): string {
  const turnId = finishedDraftMessages[messageId];
  return turnId === undefined ? messageId : `draft-${turnId}`;
}

type ChatsListView = 'skeleton' | 'error' | 'empty' | 'list';

/** A load that never showed rows gets the skeleton, a failure with no rows the centered Retry, and the empty text only once a load has settled. */
export function chatsListView(load: LoadState, chatCount: number): ChatsListView {
  if (chatCount > 0) {
    return 'list';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

type MessagesListView = 'skeleton' | 'error' | 'empty' | 'messages';

/** The message list's view state; live messages override loading. */
export function messagesListView(load: HistoryLoad, messageCount: number): MessagesListView {
  if (messageCount > 0) {
    return 'messages';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

/** A filtered or searched list that matched nothing says "No chats found"; a list with no chats at all says "No chats yet". */
export function emptyChatsText(chatCount: number): string {
  return chatCount === 0 ? 'No chats yet' : 'No chats found';
}

export type SendAttachmentOptions = {
  caption?: string;
  replyTo?: ReplyRef;
  /** Album membership (`urn:zilar:album:0`). */
  album?: AlbumRef;
};

export type SendVoiceRecording = {
  /** Local `file://` URI of the recorded bytes (m4a on iOS). */
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
  waveform: number[];
};

export interface ChatStoreState extends ChatStoreGroups, ChatStoreActions, ChatStoreCommonState {
  me?: Me;
  /** `error` keeps chats already shown: a failed refresh never blanks the list. */
  chatsLoad: LoadState;
  historyState: Record<string, HistoryLoad>;
  /** Lets the editor tell "not loaded yet" from "the folder no longer exists". */
  foldersLoaded: boolean;
  activeChatId: string | null;
  editTarget?: { chatId: string; messageId: string };
  actionError?: { chatId: string; message: string } | undefined;
  /** Hosts attachment rendering auto-loads from; undefined trusts nothing. */
  mediaTrustedHosts?: ReadonlySet<string>;
  jumpTarget?: { chatId: string; messageId: string };
  clearJumpTarget: () => void;
  reloadChats: () => void;
  sendAttachment: (chatId: string, file: PickedFile, options?: SendAttachmentOptions) => void;
  cancelAttachment: (chatId: string, messageId: string) => void;
  sendVoice: (chatId: string, recording: SendVoiceRecording, options?: SendTextOptions) => void;
  cancelVoice: (chatId: string, messageId: string) => void;
  /** Only a failed own text may relaunch the send. */
  retryText: (chatId: string, messageId: string) => void;
  deleteForMe: (chatId: string, messageId: string) => Promise<DeleteOutcome>;
  clearHistory: (chatId: string) => Promise<DeleteOutcome>;
  dismissActionError: () => void;
  /** Optimistic, with a state restore on failure. Group mute is a pref on the General row, inherited by its topics. */
  setChatPref: (chatId: string, input: PutChatPrefInput) => Promise<void>;
  pinsError?: { chatId: string; message: string };
  refreshPins: (chatId: string) => Promise<void>;
  seedCachedPins: (pins: Record<string, readonly Pin[]>) => void;
  stopPinsPoll: () => void;
  createFolder: (input: CreateChatFolderInput) => Promise<ChatFolder>;
  updateFolder: (id: string, input: PatchChatFolderInput) => Promise<ChatFolder>;
  deleteFolder: (id: string) => Promise<void>;
  reorderFolders: (ids: string[]) => Promise<void>;
}
