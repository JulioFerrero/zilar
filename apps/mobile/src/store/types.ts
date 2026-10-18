import type {
  ChatFolder,
  ChatSummary,
  EditsState,
  ReactionsState,
  UiMessage,
  AlbumRef,
  ReplyRef,
  UiMention,
  MentionMember,
} from '@zilar/chat-core';
import type { DeleteOutcome } from '@zilar/client-core/store';
import type { PatchGroupPayload } from '@zilar/api-contract';

import type { Contact, Me, GroupDetail } from '../lib/chat-api';
import type { PickedFile } from '../lib/attachment-ports';
import type { PutChatPrefInput } from '../lib/chat-prefs-api';
import type { CreateChatFolderInput, PatchChatFolderInput } from '../lib/chat-folders-api';
import type { Pin } from '../lib/pins-api';
import type { MediaPage, MediaTab } from '../lib/media-api';
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

/** "empty" is not a load state: it is what a finished load with no rows looks like. */
export type LoadState = 'loading' | 'loaded' | 'error';

type DraftState = {
  turnId: string;
  text: string;
};

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
export function messagesListView(load: LoadState, messageCount: number): MessagesListView {
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

export type SendTextOptions = {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
};

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

export type SendStickerChoice = {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
};

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type TypingState = {
  names: string[];
};

export interface ChatStoreState extends ChatStoreGroups {
  currentUserId: string;
  me?: Me;
  status: ConnectionStatus;
  /** `error` keeps chats already shown: a failed refresh never blanks the list. */
  chatsLoad: LoadState;
  chats: ChatSummary[];
  contacts: Contact[];
  messagesByChat: Record<string, UiMessage[]>;
  historyLoad: Record<string, LoadState>;
  search: string;
  activeFolder: string;
  folders: ChatFolder[];
  /** Lets the editor tell "not loaded yet" from "the folder no longer exists". */
  foldersLoaded: boolean;
  activeChatId: string | null;
  historyComplete: Record<string, boolean>;
  typing: Record<string, TypingState>;
  /** Targets are canonicalised through the alias map, so an update arriving before its target stays pending. */
  edits: Record<string, EditsState>;
  reactions: Record<string, ReactionsState>;
  drafts: Record<string, DraftState>;
  /** The final message keeps the draft's key so its reveal carries on instead of snapping. */
  finishedDraftMessages: Record<string, string>;
  editTarget?: { chatId: string; messageId: string };
  actionError?: { chatId: string; message: string } | undefined;
  /** Hosts attachment rendering auto-loads from; undefined trusts nothing. */
  mediaTrustedHosts?: ReadonlySet<string>;
  messages: (chatId: string) => UiMessage[];
  hasMore: (chatId: string) => boolean;
  openChat: (chatId: string) => void;
  /** Clears `activeChatId` when it is still the leaving chat, so later messages count as unread. */
  closeChat: (chatId: string) => void;
  /** Pages back at most `MESSAGE_JUMP_MAX_PAGES`; throws `message_not_found` when history runs out. */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  jumpTarget?: { chatId: string; messageId: string };
  clearJumpTarget: () => void;
  loadOlder: (chatId: string) => void;
  reloadChats: () => void;
  retryHistory: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
  stopTyping: (chatId: string) => void;
  sendAttachment: (chatId: string, file: PickedFile, options?: SendAttachmentOptions) => void;
  retryAttachment: (chatId: string, messageId: string) => void;
  cancelAttachment: (chatId: string, messageId: string) => void;
  sendVoice: (chatId: string, recording: SendVoiceRecording, options?: SendTextOptions) => void;
  retryVoice: (chatId: string, messageId: string) => void;
  cancelVoice: (chatId: string, messageId: string) => void;
  sendSticker: (chatId: string, sticker: SendStickerChoice, options?: SendTextOptions) => void;
  retrySticker: (chatId: string, messageId: string) => void;
  /** Only a failed own text may relaunch the send. */
  retryText: (chatId: string, messageId: string) => void;
  /** Only a `failed` message may go: the send never reached the server. */
  deleteFailedMessage: (chatId: string, messageId: string) => void;
  /** One optimistic copy per message per target, with a validated forward origin; failed and sending messages are skipped. */
  forwardMessages: (
    targets: string[],
    messages: UiMessage[],
    options?: { comment?: string },
  ) => void;
  react: (chatId: string, messageId: string, emoji: string) => void;
  startEdit: (chatId: string, messageId: string) => void;
  cancelEdit: () => void;
  editMessage: (chatId: string, messageId: string, text: string) => void;
  deleteForEveryone: (chatId: string, messageId: string) => void;
  deleteForMe: (chatId: string, messageId: string) => Promise<DeleteOutcome>;
  clearHistory: (chatId: string) => Promise<DeleteOutcome>;
  dismissActionError: () => void;
  /** Optimistic, with a state restore on failure. Group mute is a pref on the General row, inherited by its topics. */
  setChatPref: (chatId: string, input: PutChatPrefInput) => Promise<void>;
  markChatRead: (chatId: string) => Promise<void>;
  /** Newest first. */
  pins: (chatId: string) => Pin[];
  pinsError?: { chatId: string; message: string };
  refreshPins: (chatId: string) => Promise<void>;
  seedCachedPins: (pins: Record<string, readonly Pin[]>) => void;
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /** Either side of a DM, a group owner/admin for topics; the server still enforces the creator edge. */
  canPin: (chatId: string) => boolean;
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  dismissPinsError: () => void;
  stopPinsPoll: () => void;
  /** Items newest first; images and gifs carry no `url` when their host is not trusted, so they render as files. */
  loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: string) => void;
  setFolders: (folders: ChatFolder[]) => void;
  createFolder: (input: CreateChatFolderInput) => Promise<ChatFolder>;
  updateFolder: (id: string, input: PatchChatFolderInput) => Promise<ChatFolder>;
  deleteFolder: (id: string) => Promise<void>;
  reorderFolders: (ids: string[]) => Promise<void>;
  setPushPair: (input: { pushJid: string; node: string; enable: boolean }) => Promise<void>;
  start: () => void;
  stop: () => void;
}
