import type {
  Attachment,
  ChatSummary,
  EditAuthor,
  EditsState,
  EditUpdate,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  SendFailureReason,
  UiMention,
  UiMessage,
  UiReaction,
  VoiceMeta,
} from '@zilar/chat-core';
import {
  applyEdit,
  applyReaction,
  canDeleteMessage,
  canEditMessage,
  editsFor,
  emptyEdits,
  emptyReactions,
  mergeEdits,
  mergeTargets,
  mentionsForTrimmedText,
  rebaseMentions,
  resolveEdits,
  sortFolders,
  summarize,
} from '@zilar/chat-core';
import type { ForwardOrigin, Payload } from '@zilar/protocol';
import {
  AttachmentSchema,
  ForwardOriginSchema,
  PayloadSchema,
  StickerSchema,
  VoiceMetaSchema,
} from '@zilar/protocol';
import { clearChatListCache, readChatListCache, writeChatListCache } from './chatListCache';
import {
  createXmppCore,
  type ChatMessage,
  type Occupant,
  type PresenceEvent,
  type XmppCore,
  type XmppCoreOptions,
} from '@zilar/xmpp-core';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import {
  ApiError,
  addGroupAi as addGroupAiRequest,
  archiveTopic as archiveTopicRequest,
  addTopicAi as addTopicAiRequest,
  addTopicMember as addTopicMemberRequest,
  changeGroupMemberRole as changeGroupMemberRoleRequest,
  chatEntryTopics,
  createGroup as createGroupRequest,
  createGroupInviteLink as createGroupInviteLinkRequest,
  createInvite as createInviteRequest,
  createTopic as createTopicRequest,
  getChats,
  getChatBackgroundDefault as getChatBackgroundDefaultRequest,
  getContacts,
  getGroup,
  getMe,
  getTopic as getTopicRequest,
  getXmppToken,
  joinByLink as joinByLinkRequest,
  joinPublicGroup as joinPublicGroupRequest,
  listAis as listAisRequest,
  listChatPrefs as listChatPrefsRequest,
  listGroupInviteLinks as listGroupInviteLinksRequest,
  listGroupMembers as listGroupMembersRequest,
  listGroupTopics as listGroupTopicsRequest,
  lookupGroupByHandle as lookupGroupByHandleRequest,
  listPins as listPinsRequest,
  listChatMedia as listChatMediaRequest,
  listTopicAis as listTopicAisRequest,
  listTopicMembers as listTopicMembersRequest,
  patchTopic as patchTopicRequest,
  pinMessage as pinMessageRequest,
  previewJoinLink as previewJoinLinkRequest,
  putChatBackgroundDefault as putChatBackgroundDefaultRequest,
  putChatPref as putChatPrefRequest,
  removeGroupAi as removeGroupAiRequest,
  removeGroupMember as removeGroupMemberRequest,
  removeTopicAi as removeTopicAiRequest,
  removeTopicMember as removeTopicMemberRequest,
  revokeGroupInviteLink as revokeGroupInviteLinkRequest,
  searchDirectory as searchDirectoryRequest,
  setGroupVisibility as setGroupVisibilityRequest,
  setMembersCanCreateTopics as setMembersCanCreateTopicsRequest,
  setTopicRoles as setTopicRolesRequest,
  unpinMessage as unpinMessageRequest,
  type ChatEntry,
  type ChatPref,
  type ChatBackgroundChoice,
  type Contact,
  type CreateGroupInviteLinkInput,
  type CreatedInviteLink,
  type CreateTopicInput,
  type DirectoryEntry,
  type DirectoryPage,
  type GroupDetail,
  type GroupInviteLink,
  type GroupMember,
  type Invite,
  type JoinPreview,
  type JoinResult,
  type ListChatMediaInput,
  type Me,
  type MediaPage,
  type PatchTopicInput,
  type Pin,
  type PinMessageInput,
  type PublicAi,
  type PublicJoinResult,
  type PutChatPrefInput,
  type Topic,
  type TopicAi,
  type TopicMember,
  type SetTopicRolesInput,
  type XmppToken,
} from '@/lib/api';
import { authClient } from '@/lib/auth';
import { resetHandleGateDismissal } from '@/lib/handleGate';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';
import {
  subscribeToDrafts,
  type DraftEndEvent,
  type DraftHubEvent,
  type OpenDraftStream,
} from '@/lib/drafts';
import { defaultVoicePort, type VoicePort } from '@/lib/voice';
import {
  cleanFilename,
  defaultAttachmentPort,
  isTrustedMediaUrl,
  trustedMediaHosts,
  type AttachmentPort,
  type MediaTokenShape,
} from '@/lib/attachments';
import type { ChatStoreState, ConnectionStatus, DraftState } from './store';
import { applyChatPrefs, mutedUntilFor } from '@/lib/chatPrefs';
import { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from '@/lib/push';

const LAST_READ_PREFIX = 'zilar:lastRead:';
const PREVIEW_HISTORY_MAX = 1;
const PAGE_HISTORY_MAX = 50;
const TYPING_CLEAR_MS = 5000;
const CHAT_REFRESH_DEBOUNCE_MS = 500;
// Refetch `/api/chats` every 60 s while the tab is visible (T-0111), so a
// topic created, made private, or where I was removed appears or disappears
// without a reload.
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;
// Waits between XMPP connect attempts after a failed token or login.
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

// A send that neither succeeds nor fails within this long is marked failed
// with the reason `timed_out`, so a hung request cannot sit on the clock.
export const SEND_TIMEOUT_MS = 60_000;

/**
 * Maps any send-pipeline error to a fixed user-safe `SendFailureReason`
 * (T-0168). Raw error text, URLs and tokens never reach the UI or the logs:
 * the tables below read only the error class (`VoiceError`/`AttachmentError`
 * code, HTTP status, offline state).
 */
export function sendFailureReasonFor(error: unknown, offline: boolean): SendFailureReason {
  if (offline) {
    return 'network';
  }
  const code = errorCodeOf(error);
  if (code === 'too_large' || code === 'voice_too_large' || code === 'empty_file') {
    return 'too_large';
  }
  if (code === 'unsupported' || code === 'voice_empty' || code === 'invalid_response') {
    return 'unsupported_file';
  }
  if (code === 'convert_failed' || code === 'voice_failed' || code.startsWith('voice_')) {
    return 'server_unavailable';
  }
  if (code === 'upload_refused' || code === 'upload_failed') {
    return 'upload_refused';
  }
  if (code === 'timed_out') {
    return 'timed_out';
  }
  if (code === 'network_error' || code === 'network') {
    return 'network';
  }
  const status = httpStatusOf(error);
  if (status !== undefined) {
    if (status === 413) {
      return 'too_large';
    }
    if (status === 415) {
      return 'unsupported_file';
    }
    if (status === 403 || status === 404 || status === 409) {
      return 'upload_refused';
    }
    if (status >= 500) {
      return 'server_unavailable';
    }
    return 'network';
  }
  if (error instanceof Error && /timed out|timeout|aborted/i.test(error.message)) {
    return 'timed_out';
  }
  return 'network';
}

/** The typed `code` of a `VoiceError`/`AttachmentError`, or `''`. */
function errorCodeOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

/** The HTTP status of an `ApiError`, or undefined. */
function httpStatusOf(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the tab.
const FINISHED_TURNS_MAX = 50;

// Records which final message took over a draft's turn, capped like the
// finished-turn set. Insertion order is the cap order.
function rememberFinishedDraftMessage(
  record: Record<string, string>,
  messageId: string,
  turnId: string,
): Record<string, string> {
  const next = { ...record, [messageId]: turnId };
  const keys = Object.keys(next);
  if (keys.length > FINISHED_TURNS_MAX) {
    for (const key of keys.slice(0, keys.length - FINISHED_TURNS_MAX)) {
      delete next[key];
    }
  }
  return next;
}

export interface ApiClient {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  createGroup(input: {
    title: string;
    memberIds: string[];
    kind?: 'group' | 'channel';
    description?: string;
    // T-0164: `public` creates the group with a handle in one transaction.
    visibility?: 'private' | 'public';
    handle?: string;
  }): Promise<GroupDetail>;
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  // T-0164: public visibility with a handle (directory + open join), the
  // Explore search, the exact by-handle lookup, and the one-tap join.
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
  listTopicAis(topicId: string): Promise<TopicAi[]>;
  addTopicAi(topicId: string, aiId: string): Promise<Topic>;
  removeTopicAi(topicId: string, aiId: string): Promise<Topic>;
  setTopicRoles(topicId: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<GroupDetail>;
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

export interface RealStoreDeps {
  api?: ApiClient;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  storage?: StorageLike | null;
  now?: () => Date;
  documentVisible?: () => boolean;
  /** Conversion + XEP-0363 upload; tests inject fakes. */
  voice?: VoicePort;
  /** Classification, image sizing + XEP-0363 upload; tests inject fakes. */
  attachments?: AttachmentPort;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
  /** Leaves for the sign-in page after sign-out; tests inject a fake. */
  goToLogin?: () => void;
}

const realApi: ApiClient = {
  getMe,
  getChats,
  getContacts,
  getGroup,
  getXmppToken,
  createGroup: createGroupRequest,
  listGroupMembers: listGroupMembersRequest,
  setGroupVisibility: setGroupVisibilityRequest,
  searchDirectory: searchDirectoryRequest,
  lookupGroupByHandle: lookupGroupByHandleRequest,
  joinPublicGroup: joinPublicGroupRequest,
  createInvite: createInviteRequest,
  createGroupInviteLink: createGroupInviteLinkRequest,
  listGroupInviteLinks: listGroupInviteLinksRequest,
  revokeGroupInviteLink: revokeGroupInviteLinkRequest,
  changeGroupMemberRole: changeGroupMemberRoleRequest,
  removeGroupMember: removeGroupMemberRequest,
  previewJoinLink: previewJoinLinkRequest,
  joinByLink: joinByLinkRequest,
  listAis: listAisRequest,
  addGroupAi: addGroupAiRequest,
  removeGroupAi: removeGroupAiRequest,
  createTopic: createTopicRequest,
  getTopic: getTopicRequest,
  patchTopic: patchTopicRequest,
  archiveTopic: archiveTopicRequest,
  listGroupTopics: listGroupTopicsRequest,
  listTopicMembers: listTopicMembersRequest,
  addTopicMember: addTopicMemberRequest,
  removeTopicMember: removeTopicMemberRequest,
  listTopicAis: listTopicAisRequest,
  addTopicAi: addTopicAiRequest,
  removeTopicAi: removeTopicAiRequest,
  setTopicRoles: setTopicRolesRequest,
  setMembersCanCreateTopics: setMembersCanCreateTopicsRequest,
  listChatPrefs: listChatPrefsRequest,
  getChatBackgroundDefault: getChatBackgroundDefaultRequest,
  putChatBackgroundDefault: putChatBackgroundDefaultRequest,
  putChatPref: putChatPrefRequest,
  listPins: listPinsRequest,
  listChatMedia: listChatMediaRequest,
  pinMessage: pinMessageRequest,
  unpinMessage: unpinMessageRequest,
};

function readLastRead(storage: StorageLike | null, userId: string): Record<string, string> {
  if (storage === null) {
    return {};
  }
  try {
    const raw = storage.getItem(`${LAST_READ_PREFIX}${userId}`);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [chatId, messageId] of Object.entries(parsed)) {
      if (typeof messageId === 'string') {
        result[chatId] = messageId;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

// `URL.createObjectURL` is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}

function coreKind(chat: ChatSummary): 'chat' | 'groupchat' {
  return chat.kind === 'group' ? 'groupchat' : 'chat';
}

/**
 * An incoming image attachment on an untrusted host would auto-fetch from
 * whatever URL a chat peer put in the payload, leaking the viewer's IP to that
 * host. Downgrade it to a file card so the bytes are only loaded on click.
 * The same holds for a GIF-video file attachment (`gif-` name, video mime):
 * `GifMessage` auto-plays it, so on an untrusted host the `gif-` prefix is
 * stripped (breaking the inline-video match) and the dimensions dropped —
 * the card keeps the working download link but loads nothing by itself.
 * Other file attachments stay files: they never auto-load.
 */
function sanitizeIncomingAttachment(
  attachment: Attachment,
  token: MediaTokenShape | undefined,
): Attachment {
  if (attachment.kind !== 'image' && !isGifVideoName(attachment)) {
    return attachment;
  }
  const trusted = token === undefined ? undefined : trustedMediaHosts(token);
  if (trusted !== undefined && isTrustedMediaUrl(attachment.url, trusted)) {
    return attachment;
  }
  if (attachment.kind === 'image') {
    // A downgraded GIF-video (`gif-` name, video mime — the GIF send path
    // sometimes emits kind `image` with the real blob mime) must not keep
    // the prefix: `isGifVideoAttachment` is then the only remaining guard,
    // so strip it here too and let either layer alone stop the auto-play.
    // Other image names keep theirs (a bare `gif-` becomes `file`).
    const downgraded: Attachment = {
      ...attachment,
      kind: 'file',
      name: attachment.name.startsWith('gif-')
        ? unprefixedGifName(attachment.name)
        : attachment.name,
    };
    delete downgraded.width;
    delete downgraded.height;
    return downgraded;
  }
  const renamed: Attachment = { ...attachment, name: unprefixedGifName(attachment.name) };
  delete renamed.width;
  delete renamed.height;
  return renamed;
}

/** A file attachment the GIF send path would render as an inline video. */
function isGifVideoName(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}

/**
 * Strips the `gif-` prefix the inline-video match looks for, so an untrusted
 * GIF-video attachment renders as a click-to-load file card. Never empty:
 * a bare `gif-` name becomes `file`.
 */
function unprefixedGifName(name: string): string {
  const stripped = name.slice('gif-'.length);
  return stripped === '' ? 'file' : stripped;
}

/**
 * An incoming voice message on an untrusted host would make `<audio
 * preload="metadata">` fetch whatever URL a chat peer put in the payload,
 * leaking the viewer's IP just like an image would. Drop the URL: the bubble
 * still shows the waveform and the duration, but nothing is fetched.
 */
function sanitizeIncomingVoice(voice: VoiceMeta, token: MediaTokenShape | undefined): VoiceMeta {
  if (voice.url === undefined) {
    return voice;
  }
  const trusted = token === undefined ? undefined : trustedMediaHosts(token);
  if (trusted !== undefined && isTrustedMediaUrl(voice.url, trusted)) {
    return voice;
  }
  const stripped: VoiceMeta = { ...voice };
  delete stripped.url;
  return stripped;
}

function mentionLocalpart(jid: string): string {
  const bare = jid.split('/')[0] ?? jid;
  const at = bare.indexOf('@');
  return at === -1 ? bare : bare.slice(0, at);
}

function sortMessages(messages: UiMessage[]): UiMessage[] {
  return [...messages].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}

/** Drops the `failed` flag without leaving an `undefined` value behind. */
function clearFailure(message: UiMessage): UiMessage {
  if (message.failed === undefined && message.failureReason === undefined) {
    return message;
  }
  const next: UiMessage = { ...message };
  delete next.failed;
  delete next.failureReason;
  return next;
}

function sortByRecency(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => {
    const leftTime = left.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });
}

function moveChatToTop(chats: ChatSummary[], chatId: string): ChatSummary[] {
  const index = chats.findIndex((chat) => chat.id === chatId);
  if (index <= 0) {
    return chats;
  }
  const next = [...chats];
  const [chat] = next.splice(index, 1);
  if (chat !== undefined) {
    next.unshift(chat);
  }
  return next;
}

/**
 * Fresh server entries merged over what is already painted (the cached list
 * from the last visit): each chat keeps its preview and unread count, so rows
 * don't lose their second line or jump while XMPP catches up. A cached list
 * that belongs to another user is dropped.
 */
export function mergeWithPainted(
  painted: readonly ChatSummary[],
  fresh: ChatSummary[],
  paintedIsSameUser: boolean,
): ChatSummary[] {
  if (!paintedIsSameUser || painted.length === 0) {
    return fresh;
  }
  const byId = new Map(painted.map((chat) => [chat.id, chat]));
  return sortByRecency(
    fresh.map((chat) => {
      const previous = byId.get(chat.id);
      if (previous === undefined) {
        return chat;
      }
      const merged: ChatSummary = { ...chat, unread: previous.unread };
      if (previous.lastMessage !== undefined) {
        merged.lastMessage = previous.lastMessage;
      }
      return merged;
    }),
  );
}

function summaryFor(entry: ChatEntry): ChatSummary {
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: false,
    space: 'personal' as const,
    unread: 0,
    muted: false,
  };
  if (entry.kind === 'dm') {
    return {
      ...base,
      kind: 'dm',
      isAI: entry.isAi === true,
      ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
      online: false,
    };
  }
  // T-0124: channels ride the same rows as groups (their General topic is
  // the feed); the feed row carries `chatKind: 'channel'`, the subscriber
  // count and the blurb, plus the viewer's role (admins post, members read).
  // T-0164: every group row also carries `visibility` + `handle` (the web
  // paints a "Public" label from them).
  const chatKind = entry.chatKind ?? 'group';
  return {
    ...base,
    kind: 'group',
    memberCount: entry.memberCount,
    onlineCount: 0,
    visibility: entry.visibility ?? 'private',
    handle: entry.handle ?? null,
    // T-0165: the group's picture rides the entry, like DMs carry theirs.
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
    ...(chatKind === 'channel'
      ? {
          chatKind: 'channel' as const,
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          myRole: entry.role,
        }
      : {}),
  };
}

/**
 * One topic becomes its own chat row (T-0111), keyed by the topic's room JID.
 * The General topic keeps the group's old chat id, so existing `/c/<jid>`
 * deep links open it. A group without a `topics` field (older server) keeps
 * its single row from `summaryFor`. T-0124: a channel's General topic is its
 * feed, so the row carries the channel fields too.
 */
function summaryForTopic(
  groupTitle: string,
  groupId: string,
  topic: Topic,
  channel: {
    chatKind: 'channel';
    subscriberCount: number;
    description: string | null;
    role: 'owner' | 'admin' | 'member';
  } | null,
  visibility: 'private' | 'public' = 'private',
  handle: string | null = null,
  avatarUrl?: string | undefined,
): ChatSummary {
  return {
    id: topic.chatJid,
    title: topic.name,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: topic.memberCount,
    onlineCount: 0,
    // T-0164: topic rows keep their group's visibility + handle, so the
    // header and the list paint the "Public" label on topics too.
    visibility,
    handle,
    // T-0165: topic rows keep their group's picture too.
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(channel === null
      ? {}
      : {
          chatKind: 'channel' as const,
          subscriberCount: channel.subscriberCount,
          description: channel.description,
          myRole: channel.role,
        }),
    groupId,
    groupTitle,
    topic: {
      id: topic.id,
      glyph: topic.glyph,
      kind: topic.kind,
      status: topic.status,
      visibility: topic.visibility,
      isGeneral: topic.isGeneral,
      archived: false,
      owner: topic.owner,
      linkUrl: topic.linkUrl,
      linkLabel: topic.linkLabel,
    },
  };
}

/**
 * Maps one `/api/chats` entry to its chat rows: DMs and AI chats map to one
 * row as before; a group with `topics` maps to one row per visible topic
 * (General keeps the group's old chat id); a group without the field keeps
 * its single legacy row.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry)];
  }
  const topics = chatEntryTopics(entry).filter((topic) => !topic.archived);
  if (topics.length === 0) {
    return [summaryFor(entry)];
  }
  const chatKind = entry.chatKind ?? 'group';
  const channel =
    chatKind === 'channel'
      ? {
          chatKind: 'channel' as const,
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          role: entry.role,
        }
      : null;
  return topics.map((topic) =>
    summaryForTopic(
      entry.title,
      entry.groupId,
      topic,
      channel,
      entry.visibility,
      entry.handle,
      entry.avatarUrl,
    ),
  );
}

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const api = deps.api ?? realApi;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const now = deps.now ?? ((): Date => new Date());
  const isVisible = deps.documentVisible ?? defaultVisible;
  const createXmpp = deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options));
  const voicePort = deps.voice ?? defaultVoicePort;
  const attachmentPort = deps.attachments ?? defaultAttachmentPort;
  const openDrafts = deps.openDrafts ?? subscribeToDrafts;
  // A reload gives the next user a fresh store and XMPP connection.
  const goToLogin =
    deps.goToLogin ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.assign('/login');
      }
    });

  return createStore<ChatStoreState>((set, get) => {
    let core: XmppCore | undefined;
    let unsubscribers: Array<() => void> = [];
    let typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
    let sequence = 0;
    let lastRead: Record<string, string> = {};
    let lastReadUserId: string | undefined;
    let generation = 0;
    let connectRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectRetryAttempt = 0;
    // Group history (MUC MAM) only works once the room is joined, which
    // happens after the connection is online.
    let groupsJoined = false;
    // The user whose cached chat list was painted on start, if any.
    let cachedUserId: string | undefined;
    // Closes the draft stream once opened; undefined means it is not open.
    let closeDraftStream: (() => void) | undefined;
    // Fallback removal of a finished draft, keyed by chat id.
    const draftTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    // Turn ids whose draft is done, so a late `draft` is ignored.
    const finishedTurns = new Set<string>();
    const finishedTurnOrder: string[] = [];

    function saveChatList(): void {
      const state = get();
      if (state.chatsState === 'ready') {
        writeChatListCache(storage, state.currentUserId, state.chats);
        // Every painted-list change re-syncs the badge (mute changes the
        // total too, not just unread bumps).
        void syncBadge().catch(() => undefined);
      }
    }
    let firstToken: XmppToken | undefined;
    // The XMPP token the latest session connected with, kept for the media
    // allow-list (T-0065 round 1): images are only auto-loaded from hosts the
    // server names, so a chat peer cannot make every viewer fetch a tracker.
    let mediaToken: MediaTokenShape | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    // Open chat ids whose next disappearance moves silently (T-0130 review):
    // the client just archived that topic itself from its own header, so
    // the removed-while-open flow navigates without the "no longer
    // available" notice. Consumed on first use.
    const quietArchiveIds = new Set<string>();
    // The 60 s visible-tab poll for new/removed topics (T-0111), plus its
    // focus listener. Both stop when the store stops (or restarts).
    let chatsPollTimer: ReturnType<typeof setInterval> | undefined;
    let chatsPollFocusHandler: (() => void) | null = null;
    const cursors: Record<string, string | undefined> = {};
    const pendingOutgoing = new Map<string, string[]>();
    // An outgoing attachment's bytes, kept for a Retry after a failed upload.
    const pendingAttachments = new Map<string, File>();
    // An outgoing voice recording's bytes, kept for a Retry after a failed
    // send (T-0168); dropped once the stanza send succeeds, like attachments.
    const pendingVoices = new Map<string, { blob: Blob; waveform: number[] }>();
    // One in-flight send attempt's timeout handle and run token, keyed by the
    // message's alias root (T-0168). The run token lets a retry's timer and a
    // previous run's late pipeline agree on which outcome counts.
    const sendTimeouts = new Map<string, { timer: ReturnType<typeof setTimeout>; run: object }>();
    const sendTimeoutRuns = new Map<string, object>();
    const messageAliases = new Map<string, string>();
    // Local optimistic id -> the server id it resolved to, once known.
    const messageServerIds = new Map<string, string>();
    // Any known message id -> the sender-generated origin id (the stanza's
    // `id` attribute or `<origin-id/>`), used to name an edit's target.
    const messageOriginIds = new Map<string, string>();
    // Any known message id -> the author as the stanza described it, used to
    // authorize a correction or retraction from the original sender only.
    const messageAuthors = new Map<string, EditAuthor>();
    // Any known message id -> the text the message was first seen with. A
    // correction rewrites the stored message; this is what a reverted edit
    // restores.
    const messageBaseTexts = new Map<string, string>();
    const groupIds = new Map<string, string>();
    // chatId -> (lowercased user id -> member)
    const groupMembers = new Map<string, Map<string, MentionMember>>();
    // chatId -> the last group detail (people + AIs), for the info panel.
    const groupInfos = new Map<string, GroupDetail>();
    const loadingGroupMembers = new Set<string>();
    const loadingOlder = new Set<string>();
    // First-page history loads currently in flight, by chat id.
    const loadingHistory = new Set<string>();
    // Message search jumps at most this many history pages back looking for
    // the hit before giving up with "Message not found".
    const MESSAGE_JUMP_MAX_PAGES = 20;
    // Upper bound for one stalled history wait inside `openAtMessage`: after
    // this the jump gives up with "Message not found" instead of hanging.
    const MESSAGE_JUMP_WAIT_MS = 10_000;
    // Resolves true once the in-flight first-page load for a chat settles,
    // false after MESSAGE_JUMP_WAIT_MS so a stalled fetch cannot hang the
    // jump: the caller then shows "Message not found".
    function waitForHistory(chatId: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const timer = window.setInterval(() => {
          if (!loadingHistory.has(chatId)) {
            window.clearInterval(timer);
            window.clearTimeout(timeout);
            resolve(true);
          }
        }, 25);
        const timeout = window.setTimeout(() => {
          window.clearInterval(timer);
          resolve(false);
        }, MESSAGE_JUMP_WAIT_MS);
      });
    }
    // One backwards history page, shared with `loadOlder` below.
    async function loadOlderPage(chatId: string, cursor: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = core;
      if (chat === undefined || current === undefined || loadingOlder.has(chatId)) {
        return;
      }
      loadingOlder.add(chatId);
      try {
        const page = await current.loadHistory(chatId, coreKind(chat), {
          before: cursor,
          max: PAGE_HISTORY_MAX,
        });
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const older = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .map((message) => toUiMessage(message, get().currentUserId));
        resolvePendingEdits(chatId);
        const withEditsApplied = older.map((message) => withEdits(message, chatId));
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: sortMessages([...withEditsApplied, ...listFor(state, chatId)]),
          },
          historyComplete: { ...state.historyComplete, [chatId]: page.complete },
        }));
        cursors[chatId] = page.first;
        refreshEdits(chatId);
      } catch {
        // A failed page load leaves the cursor for a later retry.
      } finally {
        loadingOlder.delete(chatId);
      }
    }
    // A chat opened before the core was connected or before the chats had
    // arrived (e.g. a reload of /c/<jid>). Only the latest one counts; it
    // loads as soon as both are ready.
    let pendingOpenChatId: string | undefined;

    function persistLastRead(): void {
      if (storage === null || lastReadUserId === undefined) {
        return;
      }
      try {
        storage.setItem(`${LAST_READ_PREFIX}${lastReadUserId}`, JSON.stringify(lastRead));
      } catch {
        // A full or blocked localStorage must never break messaging.
      }
    }

    function recordRead(chatId: string, messageId: string | undefined): void {
      if (messageId !== undefined) {
        lastRead[chatId] = messageId;
        persistLastRead();
      }
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
        ),
      }));
      // The chat is read in the app: its push notifications go away and the
      // app badge drops. Both are best effort.
      void dismissChatNotifications(chatId).catch(() => undefined);
      void syncBadge().catch(() => undefined);
    }

    // Total unread excluding muted chats, mirrored to the installed app's
    // badge where the platform supports it.
    function syncBadge(): Promise<void> {
      return updateAppBadge(totalBadgeUnread(get().chats));
    }

    function signatureFor(chatId: string, body: string, replyTo: ReplyRef | undefined): string {
      return `${chatId}|${body}|${replyTo?.id ?? ''}`;
    }

    // Sticker sends share one emoji body per pack ("🐱" for every cat), so the
    // echo queue is keyed by sticker id too — otherwise two quick stickers
    // with the same emoji can link the wrong server id.
    function stickerSignatureFor(
      chatId: string,
      body: string,
      stickerId: string,
      replyTo: ReplyRef | undefined,
    ): string {
      return `${signatureFor(chatId, body, replyTo)}|sticker:${stickerId}`;
    }

    // A message may be known under its optimistic local id and later under its
    // server id. The alias map keeps the two linked so a status change can be
    // applied to whichever form is currently in the store.
    function aliasRoot(id: string): string {
      let current = id;
      let next = messageAliases.get(current);
      while (next !== undefined && next !== current) {
        current = next;
        next = messageAliases.get(current);
      }
      return current;
    }

    function linkMessageIds(left: string, right: string): void {
      if (left === right) {
        return;
      }
      const rootLeft = aliasRoot(left);
      const rootRight = aliasRoot(right);
      if (rootLeft !== rootRight) {
        messageAliases.set(rootRight, rootLeft);
        // Reactions were stored under whichever id was known when they
        // arrived; move them onto the surviving root so the alias-aware
        // lookup finds them.
        migrateReactionTargets(rootRight, rootLeft);
        migrateEditTargets(rootRight, rootLeft);
        migrateIdMap(messageOriginIds, rootRight, rootLeft);
        migrateIdMap(messageAuthors, rootRight, rootLeft);
        migrateIdMap(messageBaseTexts, rootRight, rootLeft);
      }
    }

    // Copies the value stored under `from` (when any) onto `to`, keeping both
    // keys readable; used for the per-message side tables when two ids merge.
    function migrateIdMap<T>(map: Map<string, T>, from: string, to: string): void {
      const value = map.get(from);
      if (value === undefined) {
        return;
      }
      map.set(to, value);
      map.set(from, value);
    }

    function migrateEditTargets(from: string, to: string): void {
      const state = get();
      let changed = false;
      const next: Record<string, EditsState> = { ...state.edits };
      for (const [chatId, chatEdits] of Object.entries(state.edits)) {
        if (chatEdits.targets[from] === undefined) {
          continue;
        }
        next[chatId] = mergeEdits(chatEdits, from, to);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set({ edits: next });
      for (const chatId of Object.keys(next)) {
        refreshEdits(chatId);
      }
    }

    function migrateReactionTargets(from: string, to: string): void {
      const state = get();
      let changed = false;
      const next: Record<string, ReactionsState> = { ...state.reactions };
      for (const [chatId, chatState] of Object.entries(state.reactions)) {
        if (chatState.targets[from] === undefined) {
          continue;
        }
        next[chatId] = mergeTargets(chatState, from, to);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set({ reactions: next });
      for (const chatId of Object.keys(next)) {
        refreshReactions(chatId);
      }
    }

    function sameMessage(left: string, right: string): boolean {
      return aliasRoot(left) === aliasRoot(right);
    }

    // Remembers the server id that a local optimistic id resolved to, so a
    // reaction sent after the echo can name the target everyone else knows.
    function linkLocalToServer(localId: string, serverId: string): void {
      if (localId !== serverId) {
        messageServerIds.set(localId, serverId);
      }
    }

    // The id to put on the wire for a message: the server (or archive) id when
    // it is known, else the message id itself. A still-unacked `local-*` id has
    // no server id yet and cannot be named, so it resolves to undefined.
    function wireTargetFor(messageId: string): string | undefined {
      const root = aliasRoot(messageId);
      const server = messageServerIds.get(root);
      if (server !== undefined) {
        return server;
      }
      return root.startsWith('local-') ? undefined : root;
    }

    // A reactions message is swallowed only when it is truly body-less and
    // payload-less: one that also carries a body or a payload is a normal
    // message that happens to update reactions too.
    function isReactionOnly(message: ChatMessage): boolean {
      return (
        message.reactions !== undefined &&
        message.body === undefined &&
        message.payload === undefined
      );
    }

    // A XEP-0308 correction or a XEP-0424 retraction is never a chat message:
    // it edits another message and never renders as a bubble.
    function isEditStanza(message: ChatMessage): boolean {
      return message.correction !== undefined || message.retraction !== undefined;
    }

    function authorOfChatMessage(message: ChatMessage): EditAuthor {
      const author: EditAuthor = { jid: message.fromJid, resolved: message.fromResolved };
      if (message.occupantId !== undefined) author.occupantId = message.occupantId;
      if (message.fromNick !== undefined) author.nick = message.fromNick;
      return author;
    }

    // Remembers the author as the stanza described it, under both its own id
    // and its alias root, so a later edit can be authorized without the
    // original stanza.
    function rememberAuthor(messageId: string, author: EditAuthor): void {
      messageAuthors.set(messageId, author);
      messageAuthors.set(aliasRoot(messageId), author);
    }

    function rememberOriginId(messageId: string, originId: string): void {
      messageOriginIds.set(messageId, originId);
      messageOriginIds.set(aliasRoot(messageId), originId);
    }

    function rememberBaseText(messageId: string, text: string): void {
      messageBaseTexts.set(messageId, text);
      messageBaseTexts.set(aliasRoot(messageId), text);
    }

    function baseTextFor(messageId: string): string | undefined {
      return messageBaseTexts.get(aliasRoot(messageId)) ?? messageBaseTexts.get(messageId);
    }

    function authorFor(messageId: string): EditAuthor | undefined {
      return messageAuthors.get(aliasRoot(messageId)) ?? messageAuthors.get(messageId);
    }

    // The id a correction must name: the original sender-generated id, in DMs
    // and in groups alike (XEP-0308).
    function correctionTargetFor(messageId: string): string | undefined {
      const root = aliasRoot(messageId);
      return messageOriginIds.get(root) ?? messageOriginIds.get(messageId);
    }

    // The id a retraction must name: the origin id in a DM, the stanza-id in a
    // group (XEP-0424). A still-unacked group message has no stanza-id yet.
    function retractionTargetFor(chat: ChatSummary, messageId: string): string | undefined {
      if (chat.kind === 'group') {
        const message = listFor(get(), chat.id).find((item) => sameMessage(item.id, messageId));
        const stanzaId = message?.id;
        return stanzaId === undefined || stanzaId.startsWith('local-') ? undefined : stanzaId;
      }
      return correctionTargetFor(messageId);
    }

    function editUpdateFor(message: ChatMessage): EditUpdate | undefined {
      const order = message.timestamp.getTime();
      const author = authorOfChatMessage(message);
      if (message.retraction !== undefined) {
        return {
          kind: 'retraction',
          targetId: aliasRoot(message.retraction.targetId),
          author,
          order,
        };
      }
      if (message.correction !== undefined) {
        // A correction without a body has no new text: ignore it rather than
        // blanking the original.
        if (message.body === undefined) {
          return undefined;
        }
        const update: EditUpdate = {
          kind: 'correction',
          targetId: aliasRoot(message.correction.targetId),
          author,
          text: message.body,
          order,
        };
        if (message.mentions !== undefined && message.mentions.length > 0) {
          update.mentions = message.mentions;
        }
        return update;
      }
      return undefined;
    }

    function applyEditUpdate(chatId: string, update: EditUpdate): void {
      const target = authorFor(update.targetId);
      set((state) => ({
        edits: {
          ...state.edits,
          [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, target),
        },
      }));
      resolvePendingEdits(chatId);
      refreshEdits(chatId);
    }

    // A correction or retraction message only changes edit state; it never
    // touches the preview or the unread count.
    function ingestEdit(message: ChatMessage): void {
      const update = editUpdateFor(message);
      if (update === undefined) {
        return;
      }
      applyEditUpdate(message.chatJid, update);
    }

    function ingestHistoryEdits(messages: readonly ChatMessage[]): void {
      for (const message of messages) {
        if (isEditStanza(message)) {
          ingestEdit(message);
        }
      }
    }

    // Applies the edits that arrived before their target message was loaded.
    function resolvePendingEdits(chatId: string): void {
      const chatEdits = get().edits[chatId];
      if (chatEdits === undefined) {
        return;
      }
      let next = chatEdits;
      let changed = false;
      for (const targetId of Object.keys(chatEdits.targets)) {
        const entry = next.targets[targetId];
        if (entry === undefined || entry.pending.length === 0) {
          continue;
        }
        const author = authorFor(targetId);
        if (author === undefined) {
          continue;
        }
        next = resolveEdits(next, targetId, author);
        changed = true;
      }
      if (!changed) {
        return;
      }
      set((state) => ({ edits: { ...state.edits, [chatId]: next } }));
    }

    function mentionsEqual(left: UiMention[] | undefined, right: UiMention[] | undefined): boolean {
      if (left === undefined || right === undefined) {
        return left === right;
      }
      if (left.length !== right.length) {
        return false;
      }
      return left.every((mention, index) => {
        const other = right[index];
        return (
          other !== undefined &&
          mention.jid === other.jid &&
          mention.begin === other.begin &&
          mention.end === other.end
        );
      });
    }

    // Applies one message's current edit state. A deleted message keeps only
    // its place and identity; a corrected one shows the new text and mentions.
    function withEdits(message: UiMessage, chatId: string): UiMessage {
      const chatEdits = get().edits[chatId];
      const state =
        chatEdits === undefined ? undefined : editsFor(chatEdits, aliasRoot(message.id));
      if (state === undefined || (!state.edited && !state.deleted)) {
        // A reverted edit restores the text the message was first seen with.
        const base = baseTextFor(message.id);
        const restoreText = message.text !== base;
        if (message.edited === undefined && message.deleted === undefined && !restoreText) {
          return message;
        }
        const plain: UiMessage = { ...message };
        delete plain.edited;
        delete plain.deleted;
        if (restoreText) {
          if (base === undefined) {
            delete plain.text;
          } else {
            plain.text = base;
          }
        }
        return plain;
      }
      if (state.deleted) {
        if (
          message.deleted === true &&
          message.text === undefined &&
          message.voice === undefined &&
          message.image === undefined &&
          message.attachment === undefined &&
          message.card === undefined &&
          message.reactions === undefined &&
          message.mentions === undefined &&
          message.edited === undefined &&
          message.failed === undefined &&
          message.failureReason === undefined
        ) {
          return message;
        }
        const deleted: UiMessage = { ...message, deleted: true };
        delete deleted.text;
        delete deleted.voice;
        delete deleted.image;
        delete deleted.attachment;
        delete deleted.card;
        delete deleted.reactions;
        delete deleted.mentions;
        delete deleted.edited;
        delete deleted.failed;
        delete deleted.failureReason;
        return deleted;
      }
      const text = state.text ?? message.text;
      const mentions =
        state.mentions === undefined ? undefined : mapMentions(chatId, state.mentions, text ?? '');
      if (
        message.edited === true &&
        message.deleted === undefined &&
        message.text === text &&
        mentionsEqual(message.mentions, mentions)
      ) {
        return message;
      }
      const edited: UiMessage = { ...message, edited: true };
      delete edited.deleted;
      if (text === undefined) {
        delete edited.text;
      } else {
        edited.text = text;
      }
      if (mentions === undefined || mentions.length === 0) {
        delete edited.mentions;
      } else {
        edited.mentions = mentions;
      }
      return edited;
    }

    // The list preview of a deleted message; the message itself carries no
    // text, but the chat row says what happened.
    function previewFor(message: UiMessage): UiMessage {
      return message.deleted === true ? { ...message, text: 'Message deleted' } : message;
    }

    // A reply quote follows its target: the corrected text, or "Deleted
    // message" once the target was retracted.
    function withReplyQuote(list: readonly UiMessage[], message: UiMessage): UiMessage {
      const quote = message.replyTo;
      if (quote === undefined) {
        return message;
      }
      const referenced = list.find((item) => sameMessage(item.id, quote.id));
      if (referenced === undefined) {
        return message;
      }
      const text = referenced.deleted === true ? 'Deleted message' : referenced.text;
      if (text === quote.text) {
        return message;
      }
      const replyTo: ReplyRef = { ...quote };
      if (text === undefined) {
        delete replyTo.text;
      } else {
        replyTo.text = text;
      }
      return { ...message, replyTo };
    }

    // Re-attaches the current edit state to every loaded message of a chat and
    // follows reply quotes and the preview.
    function refreshEdits(chatId: string): void {
      const state = get();
      const list = listFor(state, chatId);
      if (
        state.edits[chatId] === undefined &&
        !list.some((m) => m.edited === true || m.deleted === true)
      ) {
        return;
      }
      const edited = list.map((message) => withEdits(message, chatId));
      const refreshed = edited.map((message) => withReplyQuote(edited, message));
      const listChanged = refreshed.some((message, index) => message !== list[index]);
      const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
      const lastRefreshed =
        last === undefined ? undefined : refreshed.find((item) => sameMessage(item.id, last.id));
      const lastChanged =
        last !== undefined && lastRefreshed !== undefined && lastRefreshed !== last;
      if (!listChanged && !lastChanged) {
        return;
      }
      const changedLast = lastChanged ? lastRefreshed : undefined;
      set((previous) => ({
        messagesByChat: listChanged
          ? { ...previous.messagesByChat, [chatId]: refreshed }
          : previous.messagesByChat,
        chats:
          changedLast === undefined
            ? previous.chats
            : previous.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: previewFor(changedLast) }
                  : chat,
              ),
      }));
    }

    function restoreEdits(chatId: string, previous: EditsState | undefined): void {
      set((state) => {
        const edits = { ...state.edits };
        if (previous === undefined) {
          delete edits[chatId];
        } else {
          edits[chatId] = previous;
        }
        return { edits };
      });
      refreshEdits(chatId);
    }

    // Puts a message back exactly as it was before an optimistic edit or delete,
    // so a failed send restores the fields a retraction had stripped.
    function restoreMessage(chatId: string, snapshot: UiMessage): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, snapshot.id) ? snapshot : item,
          ),
        },
      }));
    }

    // A status only moves forward: sending -> sent -> read. A late echo or
    // send confirmation must never downgrade a message the peer already read.
    // `failed` is outside the ladder: `advanceStatus` never moves into or out
    // of it by accident — only an explicit retry does.
    const STATUS_RANK: Record<MessageStatus, number> = {
      sending: 0,
      sent: 1,
      read: 2,
      failed: 2,
    };

    function advanceStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
      if (current === 'failed' || next === 'failed') {
        return current;
      }
      return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
    }

    // Updates a message's status in the open conversation and, when it is the
    // same message, in the chat list preview, so the two always agree.
    function updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): void {
      set((state) => {
        const list = listFor(state, chatId);
        const next = list.map((item) =>
          sameMessage(item.id, messageId)
            ? { ...item, status: advanceStatus(item.status, status) }
            : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: {
                        ...chat.lastMessage,
                        status: advanceStatus(chat.lastMessage.status, status),
                      },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Swaps the placeholder voice metadata of an optimistic message for the
    // server's duration, waveform and upload URL.
    function updateMessageVoice(chatId: string, messageId: string, voice: VoiceMeta): void {
      set((state) => {
        const list = listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? { ...item, voice } : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: list },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: { ...chat.lastMessage, voice } }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Swaps an optimistic attachment for the uploaded one: the served URL plus
    // any dimensions read from the local file.
    function updateMessageAttachment(
      chatId: string,
      messageId: string,
      attachment: Attachment,
    ): void {
      set((state) => {
        const list = listFor(state, chatId).map((item) =>
          sameMessage(item.id, messageId) ? { ...clearFailure(item), attachment } : item,
        );
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches = last !== undefined && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: list },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? { ...chat, lastMessage: { ...clearFailure(chat.lastMessage), attachment } }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // A failed voice or attachment send (T-0168): the bubble leaves
    // `sending` for `failed` with a fixed user-safe reason, keeping its local
    // blob/file so it can be retried. The `failed` flag mirrors the status
    // for readers that only check it. A failure never moves a message that
    // already settled (`sent`/`read`/`failed`): a late hang racing a success
    // must not downgrade it.
    function markSendFailed(chatId: string, messageId: string, reason: SendFailureReason): void {
      set((state) => {
        const fail = (item: UiMessage): UiMessage =>
          item.status === 'sending' && sameMessage(item.id, messageId)
            ? { ...item, status: 'failed' as const, failed: true, failureReason: reason }
            : item;
        const next = listFor(state, chatId).map(fail);
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches =
          last !== undefined && last.status === 'sending' && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: {
                        ...chat.lastMessage,
                        status: 'failed' as const,
                        failed: true,
                        failureReason: reason,
                      },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Clears a bubble's send-failure state (status back to `sending`-ladder
    // shape, flags dropped) without touching its content: used when a server
    // echo proves the stanza was delivered after all. Only `failed` bubbles
    // move; anything else is left alone.
    function clearSendFailure(chatId: string, messageId: string): void {
      set((state) => {
        const clear = (item: UiMessage): UiMessage =>
          item.status === 'failed' && sameMessage(item.id, messageId)
            ? { ...clearFailure(item), status: 'sent' as const }
            : item;
        const next = listFor(state, chatId).map(clear);
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches =
          last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: { ...clearFailure(chat.lastMessage), status: 'sent' as const },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Moves a failed bubble back to `sending` for an explicit retry (T-0168).
    // Only `failed` messages move: this is the one path that may leave that
    // status, so `advanceStatus` can stay closed to it.
    function markSendRetrying(chatId: string, messageId: string): void {
      set((state) => {
        const retry = (item: UiMessage): UiMessage =>
          item.status === 'failed' && sameMessage(item.id, messageId)
            ? { ...clearFailure(item), status: 'sending' as const }
            : item;
        const next = listFor(state, chatId).map(retry);
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches =
          last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats: lastMatches
            ? state.chats.map((chat) =>
                chat.id === chatId && chat.lastMessage !== undefined
                  ? {
                      ...chat,
                      lastMessage: {
                        ...clearFailure(chat.lastMessage),
                        status: 'sending' as const,
                      },
                    }
                  : chat,
              )
            : state.chats,
        };
      });
    }

    // Removes a failed local bubble (T-0168): the send never reached the
    // server, so there is nothing to retract — only a local message still in
    // `failed` status may go. Its kept bytes go with it.
    function removeFailedMessage(chatId: string, messageId: string): void {
      pendingAttachments.delete(aliasRoot(messageId));
      pendingAttachments.delete(messageId);
      set((state) => {
        const next = listFor(state, chatId).filter(
          (item) => !(item.status === 'failed' && sameMessage(item.id, messageId)),
        );
        if (next.length === listFor(state, chatId).length) {
          return state;
        }
        const last = state.chats.find((chat) => chat.id === chatId)?.lastMessage;
        const lastMatches =
          last !== undefined && last.status === 'failed' && sameMessage(last.id, messageId);
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: sortMessages(next) },
          chats: lastMatches
            ? state.chats.map((chat) => {
                if (chat.id !== chatId) {
                  return chat;
                }
                const latest = [...next].reverse().find((item) => item.chatId === chatId);
                if (latest === undefined) {
                  const { lastMessage: _dropped, ...rest } = chat;
                  return rest;
                }
                return { ...chat, lastMessage: latest };
              })
            : state.chats,
        };
      });
    }

    // A failed sticker keeps the message and shows a Retry instead of a
    // silent "sending" state, like attachments do.
    function markStickerFailed(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId) ? { ...item, failed: true } : item,
          ),
        },
      }));
    }

    // The send step of a sticker, re-runnable from a Retry: the payload is
    // already on the optimistic message, so only the stanza is (re)sent.
    function runStickerSend(
      chat: ChatSummary,
      localId: string,
      payload: Extract<Payload, { type: 'sticker' }>,
      body: string,
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markStickerFailed(chat.id, localId);
        return;
      }
      current
        .sendMessage(chat.id, coreKind(chat), body, {
          payload,
          ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
        })
        .then((sent) => {
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          updateMessageStatus(chat.id, localId, 'sent');
        })
        .catch(() => {
          markStickerFailed(chat.id, localId);
        });
    }

    // A failed upload keeps the message and its local bytes, but shows a Retry
    // instead of a silent "sending" state.
    function markAttachmentFailed(chatId: string, messageId: string): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: listFor(state, chatId).map((item) =>
            sameMessage(item.id, messageId) ? { ...item, failed: true } : item,
          ),
        },
      }));
    }

    // One send attempt's deadline (T-0168): when it fires while the message is
    // still `sending`, the send is marked `failed` with `timed_out` and the
    // pipeline's late result is ignored. The run token pairs each timer with
    // its pipeline, so a retry's timer and a previous run's late result agree
    // on which outcome counts. The timer handle is dropped on `stop()` via
    // the same map.
    function armSendTimeout(chatId: string, messageId: string, run: object): void {
      const key = aliasRoot(messageId);
      const previous = sendTimeouts.get(key);
      if (previous !== undefined) {
        clearTimeout(previous.timer);
      }
      const timer = setTimeout(() => {
        if (sendTimeoutRuns.get(key) !== run) {
          return;
        }
        sendTimeouts.delete(key);
        sendTimeoutRuns.delete(key);
        markSendFailed(chatId, messageId, 'timed_out');
      }, SEND_TIMEOUT_MS);
      sendTimeouts.set(key, { timer, run });
      sendTimeoutRuns.set(key, run);
    }

    // The pipeline settled this run: drop its timer without firing, so a late
    // success after a manual failure (or the reverse) cannot flip the message.
    function settleSendTimeout(messageId: string, run: object): void {
      const key = aliasRoot(messageId);
      if (sendTimeoutRuns.get(key) !== run) {
        return;
      }
      const pending = sendTimeouts.get(key);
      if (pending !== undefined && pending.run === run) {
        clearTimeout(pending.timer);
        sendTimeouts.delete(key);
      }
      sendTimeoutRuns.delete(key);
    }

    // Whether `run` is still the current send attempt for `messageId`: a
    // retry arms a new run for the same message, and the older pipeline's
    // late success or failure must then ignore itself instead of flipping a
    // bubble another attempt owns.
    function isCurrentSendRun(messageId: string, run: object): boolean {
      return sendTimeoutRuns.get(aliasRoot(messageId)) === run;
    }

    // The upload steps of an attachment, re-runnable from a Retry: read the
    // image size when it is one, PUT the bytes, then send the payload message.
    function runAttachmentUpload(
      chat: ChatSummary,
      localId: string,
      file: File,
      caption: string,
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markSendFailed(chat.id, localId, 'network');
        return;
      }
      const run = {};
      armSendTimeout(chat.id, localId, run);
      void (async () => {
        try {
          const kind = attachmentPort.classify(file);
          const measured = kind === 'image' ? await attachmentPort.readImageSize(file) : undefined;
          const url = await attachmentPort.upload(current, file);
          const data: Attachment = {
            kind,
            url,
            name: cleanFilename(file.name),
            size: file.size,
            mime: file.type === '' ? 'application/octet-stream' : file.type,
            ...(measured === undefined ? {} : { width: measured.width, height: measured.height }),
          };
          updateMessageAttachment(chat.id, localId, data);
          const sent = await current.sendMessage(chat.id, coreKind(chat), caption, {
            payload: { v: 0, type: 'attachment', data },
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
          });
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          // A retried attempt may own this message now: only this run's own
          // success settles it, drops the timer and the kept bytes.
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          updateMessageStatus(chat.id, localId, 'sent');
          pendingAttachments.delete(localId);
        } catch (error) {
          // Same staleness rule on failure: a previous run racing a live
          // retry must not flip the bubble the retry owns.
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          // Keep the local bytes so the bubble can offer a Retry.
          markSendFailed(chat.id, localId, sendFailureReasonFor(error, false));
          // Pre-timeout code read only the `failed` flag; keep it in sync.
          markAttachmentFailed(chat.id, localId);
        }
      })();
    }

    function myJid(): string | undefined {
      const jid = get().me?.jid;
      return jid === undefined || jid === null || jid === '' ? undefined : jid;
    }

    function isOwnSender(fromJid: string): boolean {
      const jid = myJid();
      return jid !== undefined && fromJid === jid;
    }

    // The localpart of a JID on our own domain, used only as a lookup key.
    // It is never shown; the localpart of a user JID is the user id lowercased.
    function userLocalpartOf(fromJid: string): string | undefined {
      const mine = myJid();
      if (mine === undefined) {
        return undefined;
      }
      const domain = mine.slice(mine.indexOf('@') + 1);
      const at = fromJid.indexOf('@');
      if (at === -1) {
        return undefined;
      }
      const local = fromJid.slice(0, at);
      const host = fromJid.slice(at + 1);
      return host === domain ? local.toLowerCase() : undefined;
    }

    function groupMemberNameFor(chatId: string, fromJid: string): string | undefined {
      const members = groupMembers.get(chatId);
      if (members === undefined) {
        return undefined;
      }
      const localpart = userLocalpartOf(fromJid);
      if (localpart === undefined) {
        return undefined;
      }
      const member = members.get(localpart);
      return member !== undefined && member.name !== '' ? member.name : undefined;
    }

    function occupantNameFor(chatId: string, fromJid: string): string | undefined {
      if (core === undefined) {
        return undefined;
      }
      const occupant = core
        .occupants(chatId)
        .find((item) => item.realJid === fromJid || item.jid === fromJid);
      const nick = occupant?.nick;
      return nick !== undefined && nick !== '' ? nick : undefined;
    }

    // Resolves a display name without ever falling back to a JID localpart.
    // Order: me, contact, MUC nick, group member, room occupant, DM title,
    // then "Someone".
    function senderNameFor(message: ChatMessage): string {
      if (message.outgoing || isOwnSender(message.fromJid)) {
        return 'You';
      }
      const contact = get().contacts.find((entry) => entry.jid === message.fromJid);
      if (contact !== undefined) {
        return contact.name;
      }
      if (message.fromNick !== undefined && message.fromNick !== '') {
        return message.fromNick;
      }
      const member = groupMemberNameFor(message.chatJid, message.fromJid);
      if (member !== undefined) {
        return member;
      }
      const occupant = occupantNameFor(message.chatJid, message.fromJid);
      if (occupant !== undefined) {
        return occupant;
      }
      const chat = get().chats.find((entry) => entry.id === message.chatJid);
      if (chat !== undefined && chat.kind === 'dm') {
        return chat.title;
      }
      return 'Someone';
    }

    // A reactor's display name: "You" for me, the DM title for a DM, else the
    // group member, the room occupant, or "Someone".
    function reactorName(chatId: string, reactorJid: string): string {
      const mine = myJid();
      if (mine !== undefined && reactorJid === mine) {
        return 'You';
      }
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat !== undefined && chat.kind === 'dm') {
        return chat.title;
      }
      return (
        groupMemberNameFor(chatId, reactorJid) ?? occupantNameFor(chatId, reactorJid) ?? 'Someone'
      );
    }

    // The chips of a message, from the stored reaction updates. The lookup is
    // alias-aware, like `sameMessage`: an optimistic id and the server id of
    // the same message resolve to one target.
    function reactionChips(
      state: ReactionsState | undefined,
      chatId: string,
      messageId: string,
    ): UiReaction[] | undefined {
      if (state === undefined) {
        return undefined;
      }
      const summary = summarize(state, aliasRoot(messageId), myJid() ?? '');
      if (summary.length === 0) {
        return undefined;
      }
      return summary.map((entry) => ({
        emoji: entry.emoji,
        count: entry.count,
        mine: entry.mine,
        reactors: entry.reactors.map((reactor) => reactorName(chatId, reactor)),
      }));
    }

    function reactionsEqual(
      left: UiReaction[] | undefined,
      right: UiReaction[] | undefined,
    ): boolean {
      if (left === undefined || right === undefined) {
        return left === right;
      }
      if (left.length !== right.length) {
        return false;
      }
      return left.every((entry, index) => {
        const other = right[index];
        return (
          other !== undefined &&
          entry.emoji === other.emoji &&
          entry.count === other.count &&
          entry.mine === other.mine &&
          entry.reactors.join('\u0000') === other.reactors.join('\u0000')
        );
      });
    }

    // Re-attaches the current chips to every loaded message of a chat after a
    // reaction update changed the derived state.
    function refreshReactions(chatId: string): void {
      const state = get();
      const list = state.messagesByChat[chatId];
      const reactions = state.reactions[chatId];
      if (list === undefined || reactions === undefined) {
        return;
      }
      let changed = false;
      const next = list.map((message) => {
        const chips = reactionChips(reactions, chatId, message.id);
        if (reactionsEqual(message.reactions, chips)) {
          return message;
        }
        changed = true;
        if (chips === undefined) {
          const withoutReactions: UiMessage = { ...message };
          delete withoutReactions.reactions;
          return withoutReactions;
        }
        return { ...message, reactions: chips };
      });
      if (!changed) {
        return;
      }
      set((previous) => ({ messagesByChat: { ...previous.messagesByChat, [chatId]: next } }));
    }

    // Applies one reaction update and refreshes the loaded messages. The target
    // is canonicalised through the alias map so it matches whatever id the
    // message is currently known by.
    function applyReactionUpdate(
      chatId: string,
      targetId: string,
      reactorJid: string,
      emojis: string[],
      order: number,
    ): void {
      set((state) => ({
        reactions: {
          ...state.reactions,
          [chatId]: applyReaction(state.reactions[chatId] ?? emptyReactions(), {
            targetId: aliasRoot(targetId),
            reactorJid,
            emojis,
            order,
          }),
        },
      }));
      refreshReactions(chatId);
    }

    // A reaction update is not a chat message: it only changes reaction state,
    // so it never becomes a bubble or bumps the preview or unread count.
    function ingestReaction(message: ChatMessage): void {
      const reactions = message.reactions;
      if (reactions === undefined) {
        return;
      }
      const mine = myJid();
      const reactorJid = message.outgoing && mine !== undefined ? mine : message.fromJid;
      applyReactionUpdate(
        message.chatJid,
        reactions.targetId,
        reactorJid,
        reactions.emojis,
        message.timestamp.getTime(),
      );
    }

    function ingestHistoryReactions(messages: readonly ChatMessage[]): void {
      for (const message of messages) {
        ingestReaction(message);
      }
    }

    function rememberGroupIds(entries: ChatEntry[]): void {
      for (const entry of entries) {
        if (entry.kind === 'group') {
          for (const row of summariesFor(entry)) {
            groupIds.set(row.id, entry.groupId);
          }
        }
      }
    }

    async function applyTopicRow(topic: Topic): Promise<void> {
      const entries = await api.getChats();
      rememberGroupIds(entries);
      const rows = entries.flatMap((entry) => summariesFor(entry));
      const match = rows.find((row) => row.topic?.id === topic.id);
      set((state) => {
        // An archived topic is gone for everyone: the server excludes it
        // from the list, so drop the row at once instead of waiting for
        // the next poll. The open view follows via the removed-while-open
        // flow in `refreshChats`.
        if (match === undefined || topic.archived) {
          const filtered = state.chats.filter((chat) => chat.topic?.id !== topic.id);
          return filtered.length === state.chats.length ? state : { chats: filtered };
        }
        const before = state.chats.find((chat) => chat.id === match.id);
        const merged: ChatSummary =
          before === undefined
            ? match
            : {
                ...match,
                ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
                unread: before.unread,
                ...(before.online === undefined ? {} : { online: before.online }),
                ...(before.onlineCount === undefined ? {} : { onlineCount: before.onlineCount }),
              };
        return {
          chats: state.chats.some((chat) => chat.id === merged.id)
            ? state.chats.map((chat) => (chat.id === merged.id ? merged : chat))
            : sortByRecency([...state.chats, merged]),
        };
      });
    }

    async function topicIdFor(chatId: string): Promise<{ topicId: string; groupId: string }> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const topicId = chat?.topic?.id;
      const groupId = chat?.groupId ?? groupIds.get(chatId);
      if (topicId === undefined || groupId === undefined) {
        throw new Error('This topic is not available yet.');
      }
      return { topicId, groupId };
    }

    // The periodic + focus refresh: refetches `/api/chats` while visible so
    // a topic created, made private, or where I was removed appears or
    // disappears without a reload. Failures are silent; the next tick retries.
    // T-0114: the open chat's pins refresh on the same tick and on focus (no
    // realtime channel yet).
    const PINS_REFRESH_INTERVAL_MS = 60_000;
    let pinsPollTimer: ReturnType<typeof setInterval> | undefined;
    let pinsPollFocusHandler: (() => void) | null = null;

    function activePinsChatId(): string | undefined {
      return get().activeChatId;
    }

    // An image or GIF item on an untrusted host is downgraded to a file-style
    // item by dropping its `url`, so the panel never auto-loads it (T-0434).
    // With no XMPP token yet, nothing is trusted and every such url is dropped.
    function sanitizeMediaPage(page: MediaPage): MediaPage {
      const trusted = mediaToken === undefined ? undefined : trustedMediaHosts(mediaToken);
      return {
        ...page,
        items: page.items.map((item) => {
          if (item.kind !== 'image' && item.kind !== 'gif') {
            return item;
          }
          if (
            item.url === undefined ||
            trusted === undefined ||
            !isTrustedMediaUrl(item.url, trusted)
          ) {
            const { url: _dropped, ...rest } = item;
            void _dropped;
            return rest;
          }
          return item;
        }),
      };
    }

    async function refreshPinsFor(chatId: string): Promise<void> {
      try {
        const pins = await api.listPins(chatId);
        set((state) => ({
          pinsByChat: { ...state.pinsByChat, [chatId]: pins },
          pinsReady: { ...state.pinsReady, [chatId]: true },
        }));
      } catch {
        // Pins are best-effort; the chat works without them.
      }
    }

    function startPinsPolling(gen: number): void {
      if (typeof window === 'undefined') {
        return;
      }
      if (pinsPollTimer !== undefined) {
        clearInterval(pinsPollTimer);
      }
      const tick = (): void => {
        if (gen !== generation) {
          return;
        }
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return;
        }
        const chatId = activePinsChatId();
        if (chatId !== undefined) {
          void refreshPinsFor(chatId);
        }
      };
      pinsPollTimer = window.setInterval(tick, PINS_REFRESH_INTERVAL_MS);
      const onFocus = (): void => {
        if (gen !== generation) {
          return;
        }
        const chatId = activePinsChatId();
        if (chatId !== undefined) {
          void refreshPinsFor(chatId);
        }
      };
      window.addEventListener('focus', onFocus);
      pinsPollFocusHandler = onFocus;
    }

    function stopPinsPolling(): void {
      if (typeof window !== 'undefined') {
        if (pinsPollTimer !== undefined) {
          clearInterval(pinsPollTimer);
          pinsPollTimer = undefined;
        }
        if (pinsPollFocusHandler !== null) {
          window.removeEventListener('focus', pinsPollFocusHandler);
          pinsPollFocusHandler = null;
        }
      }
    }

    function startChatsPolling(gen: number): void {
      if (typeof window === 'undefined') {
        return;
      }
      if (chatsPollTimer !== undefined) {
        clearInterval(chatsPollTimer);
      }
      const tick = (): void => {
        if (gen !== generation) {
          return;
        }
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return;
        }
        void refreshChats();
      };
      chatsPollTimer = window.setInterval(tick, TOPIC_REFRESH_INTERVAL_MS);
      const onFocus = (): void => {
        if (gen === generation) {
          void refreshChats();
        }
      };
      window.addEventListener('focus', onFocus);
      chatsPollFocusHandler = onFocus;
    }

    function stopChatsPolling(): void {
      if (typeof window !== 'undefined') {
        if (chatsPollTimer !== undefined) {
          clearInterval(chatsPollTimer);
          chatsPollTimer = undefined;
        }
        if (chatsPollFocusHandler !== null) {
          window.removeEventListener('focus', chatsPollFocusHandler);
          chatsPollFocusHandler = null;
        }
      }
    }

    // Loads the members of a group once per chat, so a typing indicator
    // or a message from a member who is not a contact can still show a name.
    // The mention picker and the group panel read the same list. The AIs the
    // group holds (T-0054) ride along, keyed by their `ai-` localpart.
    async function ensureGroupMembers(chatId: string, force = false): Promise<void> {
      if (loadingGroupMembers.has(chatId)) {
        return;
      }
      if (!force && groupInfos.has(chatId)) {
        return;
      }
      const groupId = groupIds.get(chatId);
      const mine = myJid();
      if (groupId === undefined || mine === undefined) {
        return;
      }
      const domain = mine.slice(mine.indexOf('@') + 1);
      loadingGroupMembers.add(chatId);
      try {
        const detail = await api.getGroup(groupId);
        applyGroupDetail(chatId, detail, domain);
      } catch {
        // The name falls back to the occupant nick or "Someone".
      } finally {
        loadingGroupMembers.delete(chatId);
      }
    }

    // Caches a group detail and rebuilds the mention members from it, so the
    // picker and the panel agree after a load, an add or a remove. Handles
    // pass through from the detail (T-0169); AIs have none.
    function applyGroupDetail(chatId: string, detail: GroupDetail, domain: string): void {
      const members = new Map<string, MentionMember>();
      for (const member of detail.members) {
        const localpart = member.userId.toLowerCase();
        members.set(localpart, {
          jid: `${localpart}@${domain}`,
          name: member.name,
          ...(member.handle == null || member.handle === '' ? {} : { handle: member.handle }),
        });
      }
      for (const ai of detail.ais) {
        const localpart = (ai.jid.split('@')[0] ?? ai.jid).toLowerCase();
        members.set(localpart, { jid: ai.jid, name: ai.name });
      }
      groupMembers.set(chatId, members);
      groupInfos.set(chatId, detail);
      set((state) => ({ groupInfos: { ...state.groupInfos, [chatId]: detail } }));
    }

    // Maps the usable mentions of a message to names: the known group member,
    // else the text the range covers, else the JID's localpart.
    function mapMentions(
      chatId: string,
      mentions: readonly { jid: string; begin?: number; end?: number }[],
      body: string,
    ): UiMention[] {
      const mapped: UiMention[] = [];
      for (const mention of mentions) {
        const { begin, end } = mention;
        if (begin === undefined || end === undefined) continue;
        if (begin < 0 || begin >= end || end > body.length) continue;
        const textAtRange = body.slice(begin, end);
        const name =
          groupMemberNameFor(chatId, mention.jid) ??
          (textAtRange !== '' ? textAtRange : mentionLocalpart(mention.jid));
        mapped.push({ jid: mention.jid, name, begin, end });
      }
      return mapped;
    }

    function mentionsFor(message: ChatMessage): UiMention[] {
      const body = message.body;
      if (body === undefined || message.mentions === undefined) {
        return [];
      }
      return mapMentions(message.chatJid, message.mentions, body);
    }

    function toUiMessage(message: ChatMessage, meId: string): UiMessage {
      // The stanza id and the sender-generated id name the same message: link
      // them so a correction (which always names the origin id) resolves even
      // when the message is stored under its archive stanza-id.
      if (message.originId !== undefined && message.originId !== message.id) {
        linkMessageIds(message.originId, message.id);
      }
      rememberAuthor(message.id, authorOfChatMessage(message));
      if (message.originId !== undefined) {
        rememberOriginId(message.id, message.originId);
      }
      if (message.body !== undefined) {
        rememberBaseText(message.id, message.body);
      }
      const ui: UiMessage = {
        id: message.id,
        chatId: message.chatJid,
        senderId: message.outgoing ? meId : message.fromJid,
        senderName: senderNameFor(message),
        createdAt: message.timestamp,
        status: message.outgoing ? 'sent' : 'read',
      };
      if (message.body !== undefined) {
        ui.text = message.body;
      }
      if (message.replyTo !== undefined) {
        const referenced = get().messagesByChat[message.chatJid]?.find(
          (item) => item.id === message.replyTo?.id,
        );
        ui.replyTo = {
          id: message.replyTo.id,
          senderName: referenced?.senderName ?? '',
          ...(referenced?.text === undefined ? {} : { text: referenced.text }),
        };
      }
      if (message.forward !== undefined) {
        ui.forward = message.forward;
      }
      const mentions = mentionsFor(message);
      if (mentions.length > 0) {
        ui.mentions = mentions;
      }
      if (message.payload !== undefined && message.payload.type === 'voice') {
        ui.voice = sanitizeIncomingVoice(message.payload.data, mediaToken);
      }
      if (message.payload !== undefined && message.payload.type === 'attachment') {
        ui.attachment = sanitizeIncomingAttachment(message.payload.data, mediaToken);
      }
      if (message.payload !== undefined && message.payload.type === 'sticker') {
        // The same-origin check happens at render time (`StickerMessage`);
        // the payload is kept as-is so the bubble can show a placeholder.
        ui.card = message.payload;
      }
      const reactions = reactionChips(
        get().reactions[message.chatJid],
        message.chatJid,
        message.id,
      );
      if (reactions !== undefined) {
        ui.reactions = reactions;
      }
      return ui;
    }

    function setChatMessage(chatId: string, message: UiMessage, clearUnread: boolean): void {
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: sortMessages([...listFor(state, chatId), message]),
        },
        chats: moveChatToTop(
          state.chats.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  lastMessage: message,
                  unread: clearUnread ? 0 : chat.unread,
                }
              : chat,
          ),
          chatId,
        ),
      }));
    }

    function listFor(state: ChatStoreState, chatId: string): UiMessage[] {
      return state.messagesByChat[chatId] ?? [];
    }

    function setHistoryState(chatId: string, state: 'loading' | 'ready' | 'error'): void {
      set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
    }

    // Drops the 'loading' marker of a pending chat that was superseded before
    // it ever loaded, so no ownerless entry stays behind. Settled entries and
    // in-flight loads are left alone.
    function clearSupersededMarker(chatId: string): void {
      if (loadingHistory.has(chatId)) {
        return;
      }
      set((previous) => {
        if (previous.historyState[chatId] !== 'loading') {
          return previous;
        }
        const next = { ...previous.historyState };
        delete next[chatId];
        return { historyState: next };
      });
    }

    function markTurnFinished(turnId: string): void {
      if (finishedTurns.has(turnId)) {
        return;
      }
      finishedTurns.add(turnId);
      finishedTurnOrder.push(turnId);
      while (finishedTurnOrder.length > FINISHED_TURNS_MAX) {
        const oldest = finishedTurnOrder.shift();
        if (oldest !== undefined) {
          finishedTurns.delete(oldest);
        }
      }
    }

    function withoutDraft(
      drafts: Record<string, DraftState>,
      chatId: string,
    ): Record<string, DraftState> {
      if (drafts[chatId] === undefined) {
        return drafts;
      }
      const next = { ...drafts };
      delete next[chatId];
      return next;
    }

    function clearDraftTimeout(chatId: string): void {
      const timer = draftTimeouts.get(chatId);
      if (timer !== undefined) {
        clearTimeout(timer);
        draftTimeouts.delete(chatId);
      }
    }

    function clearDraftState(): void {
      for (const timer of draftTimeouts.values()) {
        clearTimeout(timer);
      }
      draftTimeouts.clear();
      finishedTurns.clear();
      finishedTurnOrder.length = 0;
    }

    // (Re)arms the one removal timer of a chat, replacing any previous one.
    // It removes the draft only when the same turn is still shown, so a newer
    // turn's draft is never dropped by an older turn's timer.
    function armDraftRemoval(chatJid: string, turnId: string, delay: number): void {
      clearDraftTimeout(chatJid);
      const timer = setTimeout(() => {
        draftTimeouts.delete(chatJid);
        // Not marked finished here: an idle turn (e.g. a slow tool call) may
        // resume, and its next draft must show again. `end` marks it itself.
        set((state) => {
          const current = state.drafts[chatJid];
          if (current === undefined || current.turnId !== turnId) {
            return state;
          }
          return { drafts: withoutDraft(state.drafts, chatJid) };
        });
      }, delay);
      draftTimeouts.set(chatJid, timer);
    }

    // A draft disappears only once its final message is there, so the two
    // never leave a gap. Each `draft` re-arms an idle timer (a dead turn, e.g.
    // the server restarted mid-turn, would otherwise leave the bubble forever);
    // `end` replaces it with the short fallback; the final XMPP message (a
    // separate channel) removes the draft in the same update that adds it.
    function handleDraftEvent(event: DraftHubEvent): void {
      if (event.type === 'end') {
        handleDraftEnd(event);
        return;
      }
      if (finishedTurns.has(event.turnId)) {
        return;
      }
      set((state) => ({
        drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
      }));
      armDraftRemoval(event.chatJid, event.turnId, DRAFT_IDLE_MS);
    }

    function handleDraftEnd(event: DraftEndEvent): void {
      markTurnFinished(event.turnId);
      const shown = get().drafts[event.chatJid];
      if (shown === undefined || shown.turnId !== event.turnId) {
        return;
      }
      armDraftRemoval(event.chatJid, event.turnId, DRAFT_END_FALLBACK_MS);
    }

    function startDraftStream(gen: number): void {
      if (gen !== generation || closeDraftStream !== undefined) {
        return;
      }
      closeDraftStream = openDrafts(handleDraftEvent);
    }

    function handleMessage(message: ChatMessage): void {
      // A correction or a retraction is never a chat message: it edits another
      // one, so it is ingested and returns before any rendering.
      if (isEditStanza(message)) {
        ingestEdit(message);
        return;
      }
      // A reactions message that is only that (no body, no payload) must never
      // render as a bubble or move the chat list preview. A message that also
      // carries a body or payload is a normal message: its reactions are
      // ingested and it is rendered as usual.
      if (message.reactions !== undefined) {
        ingestReaction(message);
        if (isReactionOnly(message)) {
          return;
        }
      }
      const meId = get().currentUserId;
      const chatId = message.chatJid;
      const ui = toUiMessage(message, meId);

      if (message.outgoing) {
        // Reconcile our optimistic message with the server echo. Sticker
        // echoes carry the sticker id in the payload, so they match the
        // sticker-scoped signature (not the bare emoji body).
        const replyRef =
          message.replyTo === undefined ? undefined : { id: message.replyTo.id, senderName: '' };
        const signature =
          message.payload !== undefined && message.payload.type === 'sticker'
            ? stickerSignatureFor(
                chatId,
                message.body ?? '',
                message.payload.data.sticker_id,
                replyRef,
              )
            : signatureFor(chatId, message.body ?? '', replyRef);
        const queue = pendingOutgoing.get(signature);
        const localId = queue?.shift();
        if (queue !== undefined && queue.length === 0) {
          pendingOutgoing.delete(signature);
        }
        if (localId !== undefined) {
          linkMessageIds(localId, ui.id);
          linkLocalToServer(localId, ui.id);
          // An echo is proof the stanza reached the server: a bubble the
          // pipeline had marked `failed` is delivered after all, so it moves
          // to `sent` and its kept retry bytes can go, whichever pipeline
          // stored them. `advanceStatus` below still guards against a later
          // `sending`/`failed` update downgrading it again.
          clearSendFailure(chatId, ui.id);
          updateMessageStatus(chatId, ui.id, 'sent');
          const root = aliasRoot(localId);
          pendingVoices.delete(localId);
          pendingVoices.delete(root);
          pendingAttachments.delete(localId);
          pendingAttachments.delete(root);
        }
        set((state) => {
          const existing = listFor(state, chatId);
          const previous = existing.find((item) => sameMessage(item.id, ui.id));
          const reconciled: UiMessage =
            previous === undefined
              ? ui
              : { ...ui, status: advanceStatus(previous.status, ui.status) };
          const withoutLocal =
            localId === undefined ? existing : existing.filter((item) => item.id !== localId);
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([
                ...withoutLocal.filter((item) => item.id !== reconciled.id),
                reconciled,
              ]),
            },
            chats: moveChatToTop(
              state.chats.map((chat) =>
                chat.id === chatId ? { ...chat, lastMessage: reconciled } : chat,
              ),
              chatId,
            ),
          };
        });
        return;
      }

      const active = get().activeChatId === chatId && isVisible();
      const isRead = active;
      // Only the AI's own message in its DM finishes the draft. A message from
      // my own JID (e.g. my second device) must leave the draft running.
      const fromAi = message.fromJid === chatId && !isOwnSender(message.fromJid);
      const draft = get().drafts[chatId];
      if (draft !== undefined && fromAi) {
        markTurnFinished(draft.turnId);
        clearDraftTimeout(chatId);
      }
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: sortMessages([
            ...listFor(state, chatId).filter((item) => item.id !== ui.id),
            ui,
          ]),
        },
        chats: moveChatToTop(
          state.chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, lastMessage: ui, unread: isRead ? 0 : chat.unread + 1 }
              : chat,
          ),
          chatId,
        ),
        // The final message replaces the draft in one update: the bubble never
        // leaves the screen, so there is no gap and no duplicate.
        drafts: draft !== undefined && fromAi ? withoutDraft(state.drafts, chatId) : state.drafts,
        // Remember the turn so the bubble keeps revealing on the draft's key.
        finishedDraftMessages:
          draft !== undefined && fromAi
            ? rememberFinishedDraftMessage(state.finishedDraftMessages, ui.id, draft.turnId)
            : state.finishedDraftMessages,
      }));
      // A message that just loaded may be the target of a correction or a
      // retraction read earlier, from an older history page.
      resolvePendingEdits(chatId);
      refreshEdits(chatId);
      if (!isRead) {
        void syncBadge().catch(() => undefined);
      }
      if (isRead && core !== undefined) {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat !== undefined) {
          recordRead(chatId, ui.id);
          core.markDisplayed(chatId, coreKind(chat), ui.id);
        }
      }
    }

    function handleTyping(event: {
      chatJid: string;
      fromJid: string;
      state: string;
      outgoing: boolean;
    }): void {
      // A MUC reflects my own chat states back to me. When the sender cannot be
      // resolved to a real JID, xmpp-core marks the reflection `outgoing` and
      // keeps the full room JID, so the JID check alone is not enough.
      if (event.outgoing || isOwnSender(event.fromJid)) {
        return;
      }
      const chatId = event.chatJid;
      void ensureGroupMembers(chatId);
      const name = senderNameFor({
        chatJid: chatId,
        fromJid: event.fromJid,
        outgoing: false,
      } as ChatMessage);
      const existing = typingTimers[chatId];
      if (existing !== undefined) {
        clearTimeout(existing);
      }
      if (event.state === 'composing') {
        set((state) => ({ typing: { ...state.typing, [chatId]: { names: [name] } } }));
        typingTimers[chatId] = setTimeout(() => {
          set((state) => {
            const next = { ...state.typing };
            delete next[chatId];
            return { typing: next };
          });
          delete typingTimers[chatId];
        }, TYPING_CLEAR_MS);
      } else {
        set((state) => {
          const next = { ...state.typing };
          delete next[chatId];
          return { typing: next };
        });
      }
    }

    function handleDisplayed(event: {
      chatJid: string;
      fromJid: string;
      messageId: string;
      outgoing: boolean;
    }): void {
      // A reflected marker of my own message means I displayed it, not that a
      // peer read it. `outgoing` covers the unresolved full-room-JID case.
      if (event.outgoing || isOwnSender(event.fromJid)) {
        return;
      }
      updateMessageStatus(event.chatJid, event.messageId, 'read');
    }

    function handleOccupants(event: { roomJid: string; occupants: Occupant[] }): void {
      const online = event.occupants.filter((occupant) => occupant.available).length;
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.roomJid
            ? {
                ...chat,
                onlineCount: online,
                memberCount: Math.max(chat.memberCount ?? 0, event.occupants.length),
              }
            : chat,
        ),
      }));
    }

    function handlePresence(event: PresenceEvent): void {
      set((state) => ({
        chats: state.chats.map((chat) =>
          chat.id === event.jid
            ? {
                ...chat,
                online: event.available,
                ...(event.available ? {} : { lastSeenAt: now() }),
              }
            : chat,
        ),
      }));
    }

    function subscribe(current: XmppCore): void {
      unsubscribers = [
        current.on('status', (status: ConnectionStatus) => {
          set({ status });
          if (status === 'online') {
            flushPending();
          }
        }),
        current.on('message', handleMessage),
        current.on('typing', handleTyping),
        current.on('displayed', handleDisplayed),
        current.on('occupants', handleOccupants),
        current.on('presence', handlePresence),
        current.on('invited', handleInvited),
        current.on('roster', handleRoster),
      ];
    }

    function nick(me: Me): string {
      const name = me.name.trim();
      if (name.length > 0) {
        return name;
      }
      return me.jid?.split('@')[0] ?? 'me';
    }

    async function joinGroups(current: XmppCore, me: Me): Promise<void> {
      for (const chat of get().chats) {
        if (chat.kind !== 'group') {
          continue;
        }
        void ensureGroupMembers(chat.id);
        try {
          await current.joinRoom(chat.id, nick(me));
        } catch {
          // A room can be joined later when the user opens it.
        }
      }
    }

    // A group invitation or a roster push means the chat list changed on the
    // server. Refetch it, join any new group rooms and load their preview.
    function handleInvited(): void {
      scheduleChatsRefresh();
    }

    function handleRoster(): void {
      scheduleChatsRefresh();
    }

    function scheduleChatsRefresh(): void {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshChats();
      }, CHAT_REFRESH_DEBOUNCE_MS);
    }

    // The throwing half of `refreshChats`: fetches the list and merges it,
    // reporting fetch failures to the caller. The background callers
    // (poll, focus, roster) swallow them and retry on the next tick; the
    // row re-check (`refreshTopicRow`) lets them throw instead of reading
    // a stale list as "alive".
    async function refreshChats(): Promise<void> {
      try {
        await refreshChatsOrThrow();
      } catch {
        return;
      }
    }

    async function refreshChatsOrThrow(): Promise<void> {
      const gen = generation;
      const [entries, prefs] = await Promise.all([
        api.getChats(),
        api.listChatPrefs().catch(() => [] as ChatPref[]),
      ]);
      if (gen !== generation) {
        // A newer `start()`/`stop()` superseded this refresh (boot,
        // retry, sign-out): the list below is stale, so say so instead
        // of merging it — the caller (`refreshTopicRow`) rejects rather
        // than read stale state as "topic alive".
        throw new ApiError(0, 'stale_refresh', 'The chat list refresh was superseded');
      }

      const previous = get().chats;
      const known = new Map(previous.map((chat) => [chat.id, chat]));
      const activeChatId = get().activeChatId;
      const freshRows = entries.flatMap((entry) => summariesFor(entry));
      const fresh = freshRows.filter((row) => !known.has(row.id));
      const kept = freshRows
        .filter((row) => known.has(row.id))
        .map((row) => {
          const existing = known.get(row.id);
          if (existing === undefined) {
            return row;
          }
          return {
            ...row,
            ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
            unread: existing.unread,
            ...(existing.online === undefined ? {} : { online: existing.online }),
            ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
          };
        });
      // New chats appear at the top; the rest keep their recency order.
      const byJid: Record<string, ChatPref> = {};
      for (const pref of prefs) {
        byJid[pref.chatJid.toLowerCase()] = pref;
      }
      set({
        chats: applyChatPrefs([...fresh, ...sortByRecency(kept)], prefs, now().getTime()),
        chatPrefs: byJid,
      });
      rememberGroupIds(entries);
      // A topic that disappeared while open (made private, archived, or I was
      // removed) navigates to the group's General topic with a short notice —
      // unless the disappearance was just caused by this client on purpose
      // (e.g. archiving the open topic from its own header): ids in
      // `quietArchiveIds` move silently.
      const openChat =
        activeChatId === undefined
          ? undefined
          : get().chats.find((chat) => chat.id === activeChatId);
      if (activeChatId !== undefined && openChat === undefined) {
        // A deliberate self-archive moves silently: consume the quiet mark
        // while resolving this disappearance, whichever branch handles it.
        // Deleting only inside the General branch leaks the id when General
        // is absent — or when `applyTopicRow` already dropped the row, so
        // `was` below is undefined — and the leaked mark would silence a
        // later, unrelated removal.
        const quiet = quietArchiveIds.has(activeChatId);
        quietArchiveIds.delete(activeChatId);
        const was = previous.find((chat) => chat.id === activeChatId);
        const notice =
          was?.topic === undefined || was.groupId === undefined
            ? undefined
            : { groupId: was.groupId, groupTitle: was.groupTitle ?? '' };
        if (notice !== undefined) {
          const general = get().chats.find(
            (chat) => chat.groupId === notice.groupId && chat.topic?.isGeneral === true,
          );
          if (general !== undefined) {
            set({
              activeChatId: general.id,
              topicNotice: quiet
                ? undefined
                : { chatId: general.id, message: 'This topic is no longer available.' },
            });
            if (typeof window !== 'undefined') {
              window.history.replaceState(null, '', `/c/${encodeURIComponent(general.id)}`);
            }
          } else {
            set({ activeChatId: undefined });
            if (typeof window !== 'undefined') {
              window.history.replaceState(null, '', '/');
            }
          }
        } else {
          set({ activeChatId: undefined });
        }
      }
      flushPending();

      const current = core;
      const me = get().me;
      if (current === undefined || me === undefined) {
        return;
      }
      for (const entry of entries) {
        if (entry.kind !== 'group') {
          continue;
        }
        for (const row of summariesFor(entry)) {
          if (known.has(row.id)) {
            continue;
          }
          await current.joinRoom(row.id, nick(me)).catch(() => {});
          void ensureGroupMembers(row.id);
        }
      }
      for (const row of freshRows) {
        if (known.has(row.id)) {
          continue;
        }
        const chat = get().chats.find((item) => item.id === row.id);
        if (chat !== undefined) {
          await loadPreview(current, chat);
        }
      }
    }

    async function loadPreview(current: XmppCore, chat: ChatSummary): Promise<void> {
      try {
        const page = await current.loadHistory(chat.id, coreKind(chat), {
          max: PREVIEW_HISTORY_MAX,
        });
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const last = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .at(-1);
        if (last === undefined) {
          return;
        }
        const ui = toUiMessage(last, get().currentUserId);
        resolvePendingEdits(chat.id);
        const preview = previewFor(withEdits(ui, chat.id));
        set((state) => ({
          chats: state.chats.map((entry) =>
            entry.id === chat.id && entry.lastMessage === undefined
              ? { ...entry, lastMessage: preview }
              : entry,
          ),
        }));
        if (lastRead[chat.id] === undefined) {
          lastRead[chat.id] = ui.id;
          persistLastRead();
        }
        cursors[chat.id] = page.first;
        set((state) => ({
          historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
        }));
      } catch {
        // Preview is best-effort; the chat still works when opened.
      }
    }

    // Runs the pending open once the core is connected and the chat is
    // known. Called after every point where either can become ready: the
    // first chat merge, a background refresh, and (re)connect.
    function flushPending(): void {
      const pending = pendingOpenChatId;
      if (pending === undefined) {
        return;
      }
      const chat = get().chats.find((entry) => entry.id === pending);
      if (chat === undefined || !canLoadHistory(chat)) {
        return;
      }
      pendingOpenChatId = undefined;
      void openHistory(pending);
    }

    function canLoadHistory(chat: ChatSummary): boolean {
      return (
        core !== undefined && get().status === 'online' && (chat.kind !== 'group' || groupsJoined)
      );
    }

    async function openHistory(chatId: string): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const current = core;
      // `core` is assigned before `connect()` resolves, so "ready" means
      // online: a MAM query sent while still connecting fails.
      if (current === undefined || chat === undefined || !canLoadHistory(chat)) {
        // The chat screen mounted before the data was there (e.g. a reload
        // of /c/<jid>). Remember it and load once both are ready.
        pendingOpenChatId = chatId;
        setHistoryState(chatId, 'loading');
        return;
      }
      if (loadingHistory.has(chatId)) {
        // A load for this chat is already in flight; it covers this open.
        if (pendingOpenChatId === chatId) {
          pendingOpenChatId = undefined;
        }
        return;
      }
      if (pendingOpenChatId === chatId) {
        pendingOpenChatId = undefined;
      }
      loadingHistory.add(chatId);
      setHistoryState(chatId, 'loading');
      try {
        const page = await current.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX });
        ingestHistoryReactions(page.messages);
        ingestHistoryEdits(page.messages);
        const loaded = page.messages
          .filter((message) => !isReactionOnly(message) && !isEditStanza(message))
          .map((message) => toUiMessage(message, get().currentUserId));
        resolvePendingEdits(chatId);
        const withEditsApplied = loaded.map((message) => withEdits(message, chatId));
        const newest = withEditsApplied.at(-1);
        set((state) => {
          const live = listFor(state, chatId).filter(
            (message) => !withEditsApplied.some((item) => sameMessage(item.id, message.id)),
          );
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...withEditsApplied, ...live]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
            chats:
              newest === undefined
                ? state.chats
                : state.chats.map((entry) =>
                    entry.id === chatId ? { ...entry, lastMessage: previewFor(newest) } : entry,
                  ),
          };
        });
        cursors[chatId] = page.first;
        refreshEdits(chatId);
        const last = withEditsApplied.at(-1);
        if (last !== undefined) {
          recordRead(chatId, last.id);
          current.markDisplayed(chatId, coreKind(chat), last.id);
        }
        setHistoryState(chatId, 'ready');
      } catch {
        // Keep whatever live messages we have; the view offers a retry.
        setHistoryState(chatId, 'error');
      } finally {
        loadingHistory.delete(chatId);
      }
      flushPending();
    }

    function loadOlder(chatId: string): void {
      const cursor = cursors[chatId];
      if (cursor === undefined) {
        return;
      }
      void loadOlderPage(chatId, cursor);
    }

    async function boot(gen: number): Promise<void> {
      let me: Me;
      let entries: ChatEntry[];
      let contacts: Contact[];
      let prefs: ChatPref[];
      try {
        [me, entries, contacts, prefs] = await Promise.all([
          api.getMe(),
          api.getChats(),
          api.getContacts(),
          api.listChatPrefs().catch(() => [] as ChatPref[]),
        ]);
      } catch {
        if (gen === generation) {
          set({ status: 'offline', chatsState: 'error' });
        }
        return;
      }
      if (gen !== generation) {
        return;
      }

      lastReadUserId = me.id;
      lastRead = readLastRead(storage, me.id);
      rememberGroupIds(entries);
      const freshRows = entries.flatMap((entry) => summariesFor(entry));
      const byJid: Record<string, ChatPref> = {};
      for (const pref of prefs) {
        byJid[pref.chatJid.toLowerCase()] = pref;
      }
      set({
        me,
        currentUserId: me.id,
        chats: applyChatPrefs(
          mergeWithPainted(get().chats, freshRows, cachedUserId === me.id),
          prefs,
          now().getTime(),
        ),
        contacts,
        chatPrefs: byJid,
        chatsState: 'ready',
      });
      // T-0461: the global background default is a nice-to-have; load it
      // without holding up the chat list, and leave it null on failure.
      void get().refreshDefaultBackground();
      startDraftStream(gen);
      startChatsPolling(gen);
      startPinsPolling(gen);
      flushPending();
      await connectXmpp(gen, me);
    }

    // After a failed token or login, try again with growing waits instead of
    // staying offline until a reload (a 429 on the token route used to leave
    // the app on "Waiting for network…" for good).
    function scheduleConnectRetry(gen: number, me: Me): void {
      if (gen !== generation || connectRetryTimer !== undefined) {
        return;
      }
      const delay =
        CONNECT_RETRY_DELAYS_MS[Math.min(connectRetryAttempt, CONNECT_RETRY_DELAYS_MS.length - 1)];
      connectRetryAttempt += 1;
      connectRetryTimer = setTimeout(() => {
        connectRetryTimer = undefined;
        if (gen === generation) {
          void connectXmpp(gen, me);
        }
      }, delay);
    }

    async function connectXmpp(gen: number, me: Me): Promise<void> {
      let token: XmppToken;
      try {
        token = await api.getXmppToken();
      } catch {
        if (gen === generation) {
          set({ status: 'offline' });
          scheduleConnectRetry(gen, me);
        }
        return;
      }
      if (gen !== generation) {
        return;
      }
      firstToken = token;
      mediaToken = { service: token.service, domain: token.domain };
      set({ mediaTrustedHosts: trustedMediaHosts(mediaToken) });

      const options: XmppCoreOptions = {
        service: token.service,
        domain: token.domain,
        getToken: async () => {
          if (firstToken !== undefined) {
            const fresh = firstToken;
            firstToken = undefined;
            return { jid: fresh.jid, token: fresh.token };
          }
          const fresh = await api.getXmppToken();
          mediaToken = { service: fresh.service, domain: fresh.domain };
          set({ mediaTrustedHosts: trustedMediaHosts(mediaToken) });
          return { jid: fresh.jid, token: fresh.token };
        },
      };

      const current = createXmpp(options);
      core = current;
      subscribe(current);
      try {
        await current.connect();
      } catch {
        if (gen === generation) {
          set({ status: 'offline' });
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
          unsubscribers = [];
          core = undefined;
          void current.disconnect().catch(() => {});
          scheduleConnectRetry(gen, me);
        }
        return;
      }
      if (gen !== generation) {
        void current.disconnect().catch(() => {});
        return;
      }
      connectRetryAttempt = 0;
      set({ status: 'online' });
      flushPending();
      await joinGroups(current, me);
      if (gen === generation) {
        groupsJoined = true;
        flushPending();
      }
      await Promise.all(get().chats.map((chat) => loadPreview(current, chat)));
      if (gen === generation) {
        set((state) => ({ chats: sortByRecency(state.chats) }));
        saveChatList();
      }
    }

    // T-0113: pref helpers. `applyPrefs` replaces the pref map and merges it
    // into the painted list; `updatePref` patches one row optimistically and
    // rolls back to the previous pref state when the PUT fails.
    function applyPrefs(prefs: ChatPref[]): void {
      const byJid: Record<string, ChatPref> = {};
      for (const pref of prefs) {
        byJid[pref.chatJid.toLowerCase()] = pref;
      }
      set((state) => ({
        chatPrefs: byJid,
        chats: applyChatPrefs(state.chats, prefs, now().getTime()),
      }));
      void syncBadge().catch(() => undefined);
    }

    async function updatePref(chatId: string, patch: PutChatPrefInput): Promise<void> {
      const chat = get().chats.find((entry) => entry.id === chatId);
      if (chat === undefined) {
        throw new Error('This chat is not available yet.');
      }
      const previous = get().chatPrefs;
      const nowDate = now();
      const key = chatId.toLowerCase();
      const optimistic: ChatPref = {
        chatJid: chatId,
        mutedUntil:
          patch.mutedUntil !== undefined ? patch.mutedUntil : (previous[key]?.mutedUntil ?? null),
        archived:
          patch.archived !== undefined ? patch.archived : (previous[key]?.archived ?? false),
        pinnedAt:
          patch.pinned !== undefined
            ? patch.pinned
              ? (previous[key]?.pinnedAt ?? nowDate.toISOString())
              : null
            : (previous[key]?.pinnedAt ?? null),
        // T-0462: keep the background override on the optimistic row. A patch
        // value wins, an omitted field keeps the previous one, else null.
        backgroundPreset:
          patch.backgroundPreset !== undefined
            ? patch.backgroundPreset
            : (previous[key]?.backgroundPreset ?? null),
        backgroundImageId:
          patch.backgroundImageId !== undefined
            ? patch.backgroundImageId
            : (previous[key]?.backgroundImageId ?? null),
        backgroundDim:
          patch.backgroundDim !== undefined
            ? patch.backgroundDim
            : (previous[key]?.backgroundDim ?? null),
        updatedAt: nowDate.toISOString(),
      };
      const next: Record<string, ChatPref> = { ...previous };
      if (
        optimistic.mutedUntil === null &&
        optimistic.archived === false &&
        optimistic.pinnedAt === null &&
        optimistic.backgroundPreset === null &&
        optimistic.backgroundImageId === null &&
        optimistic.backgroundDim === null
      ) {
        delete next[key];
      } else {
        next[key] = optimistic;
      }
      set((state) => ({
        chatPrefs: next,
        chats: applyChatPrefs(state.chats, Object.values(next), nowDate.getTime()),
      }));
      // Muting changes the badge total (and unmuting restores it): re-sync
      // like recordRead does, on the optimistic paint and on every settle.
      void syncBadge().catch(() => undefined);
      let saved: ChatPref | null;
      try {
        saved = await api.putChatPref(chatId, patch);
      } catch (error) {
        // Roll back to the previous prefs and re-merge.
        set((state) => ({
          chatPrefs: previous,
          chats: applyChatPrefs(state.chats, Object.values(previous), now().getTime()),
        }));
        void syncBadge().catch(() => undefined);
        throw error;
      }
      set((state) => {
        const merged: Record<string, ChatPref> = { ...get().chatPrefs };
        if (saved === null) {
          delete merged[key];
        } else {
          merged[key] = saved;
        }
        return {
          chatPrefs: merged,
          chats: applyChatPrefs(state.chats, Object.values(merged), now().getTime()),
        };
      });
      void syncBadge().catch(() => undefined);
    }

    // The voice pipeline, re-runnable from a Retry (T-0168): convert, PUT
    // the bytes, then send the payload message. Every throw — conversion,
    // upload or the final send — lands the bubble in `failed` with a fixed
    // user-safe reason, never a clock forever. The recording's bytes stay
    // in `pendingVoices` until the stanza send succeeds, so a Retry after
    // the cause is fixed re-runs the same pipeline from the retained blob.
    function runVoiceSend(
      chat: ChatSummary,
      localId: string,
      blob: Blob,
      waveform: number[],
      replyTo: ReplyRef | undefined,
    ): void {
      const current = core;
      if (current === undefined) {
        markSendFailed(chat.id, localId, 'network');
        return;
      }
      const run = {};
      armSendTimeout(chat.id, localId, run);
      void (async () => {
        try {
          const converted = await voicePort.convert(blob);
          const url = await voicePort.upload(current, converted.audio);
          const voice: VoiceMeta = {
            duration_ms: converted.durationMs,
            mime: 'audio/mp4',
            waveform,
            url,
          };
          updateMessageVoice(chat.id, localId, voice);
          const sent = await current.sendMessage(chat.id, coreKind(chat), '', {
            payload: { v: 0, type: 'voice', data: voice },
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
          });
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          // A retried attempt may own this message now: only this run's own
          // success settles it, drops the timer and the kept bytes.
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          updateMessageStatus(chat.id, localId, 'sent');
          pendingVoices.delete(localId);
          pendingVoices.delete(aliasRoot(localId));
        } catch (error) {
          // Same staleness rule on failure: a previous run racing a live
          // retry must not flip the bubble the retry owns.
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          // The optimistic bubble keeps its local audio; the failure shows
          // "Not sent" with Retry and Delete instead of a clock.
          markSendFailed(chat.id, localId, sendFailureReasonFor(error, false));
        }
      })();
    }

    // The room identity a forward may carry (T-0414): only a public group or
    // topic has a room JID safe to reveal. A DM/AI chat has no room JID, and a
    // private topic (or private group) must omit both so the target never
    // learns a room it may not see (forwarding plan §3.1/§3.6).
    function forwardPublicRoomFor(source: ChatSummary | undefined): ChatSummary | undefined {
      if (source === undefined || source.kind !== 'group') {
        return undefined;
      }
      const visibility = source.topic?.visibility ?? source.visibility;
      return visibility === 'public' ? source : undefined;
    }

    // The origin header of one forwarded copy. Reusing a message's own
    // `forward` keeps the first author on a forward of a forward. Otherwise it
    // is built from the source message; `ForwardOriginSchema` caps over-long
    // names and rejects a bad timestamp, and such a message is skipped instead
    // of putting junk on the wire.
    function forwardOriginFor(message: UiMessage): ForwardOrigin | undefined {
      if (message.forward !== undefined) {
        const reused = ForwardOriginSchema.safeParse(message.forward);
        return reused.success ? reused.data : undefined;
      }
      const createdAt = message.createdAt.getTime();
      if (Number.isNaN(createdAt)) {
        return undefined;
      }
      const author = authorFor(message.id);
      const room = forwardPublicRoomFor(get().chats.find((entry) => entry.id === message.chatId));
      const originalId = correctionTargetFor(message.id);
      const candidate = {
        sender_id: author?.jid ?? message.senderId,
        sender_name: message.senderName,
        ...(room === undefined ? {} : { chat_id: room.id, chat_name: room.title }),
        ...(originalId === undefined ? {} : { original_id: originalId }),
        original_at: new Date(createdAt).toISOString(),
      };
      const parsed = ForwardOriginSchema.safeParse(candidate);
      return parsed.success ? parsed.data : undefined;
    }

    // The reused payload of a forwarded message: a sticker or other card as-is,
    // an attachment or voice rebuilt from the UiMessage fields. The voice
    // transcript is dropped (it is chat-scoped). Every payload is validated
    // with the protocol schema before the optimistic insert, like `sendSticker`.
    function forwardedPayloadFor(message: UiMessage): Payload | undefined {
      if (message.card !== undefined) {
        return PayloadSchema.safeParse(message.card).success ? message.card : undefined;
      }
      if (message.attachment !== undefined) {
        const data = message.attachment;
        return AttachmentSchema.safeParse(data).success
          ? { v: 0, type: 'attachment', data }
          : undefined;
      }
      if (message.voice !== undefined) {
        const { transcript: _transcript, ...data } = message.voice;
        return VoiceMetaSchema.safeParse(data).success ? { v: 0, type: 'voice', data } : undefined;
      }
      return undefined;
    }

    // The content fields a forwarded payload paints into the optimistic bubble,
    // so it looks like the echo the matching normal send would produce.
    function forwardedUiFieldsFor(
      payload: Payload,
    ): Pick<UiMessage, 'voice' | 'attachment' | 'card'> {
      if (payload.type === 'attachment') {
        return { attachment: payload.data };
      }
      if (payload.type === 'voice') {
        return { voice: payload.data };
      }
      return { card: payload };
    }

    // One forwarded copy's send: the same timeout/status machinery as voice and
    // attachments, with a fixed user-safe reason on failure.
    function runForwardSend(
      target: ChatSummary,
      localId: string,
      body: string,
      payload: Payload | undefined,
      origin: ForwardOrigin,
    ): void {
      const current = core;
      if (current === undefined) {
        markSendFailed(target.id, localId, 'network');
        return;
      }
      const run = {};
      armSendTimeout(target.id, localId, run);
      current
        .sendMessage(target.id, coreKind(target), body, {
          ...(payload === undefined ? {} : { payload }),
          forward: origin,
        })
        .then((sent) => {
          linkMessageIds(localId, sent.id);
          linkLocalToServer(localId, sent.id);
          rememberOriginId(localId, sent.id);
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          updateMessageStatus(target.id, localId, 'sent');
        })
        .catch((error) => {
          if (!isCurrentSendRun(localId, run)) {
            return;
          }
          settleSendTimeout(localId, run);
          markSendFailed(target.id, localId, sendFailureReasonFor(error, false));
        });
    }

    return {
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      // Unknown means never requested, and the real store never has data
      // without requesting it: that is still loading, never empty.
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'loading',
      chats: [],
      contacts: [],
      chatPrefs: {},
      defaultBackground: null,
      messagesByChat: {},
      reactions: {},
      pinsByChat: {},
      pinsReady: {},
      pinsError: undefined,
      dismissPinsError: () => set({ pinsError: undefined }),
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => [...(groupMembers.get(chatId)?.values() ?? [])],
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: (chatId) => {
        void ensureGroupMembers(chatId, true);
      },
      listMyAis: () => api.listAis(),
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      refreshChats: () => {
        scheduleChatsRefresh();
      },
      // T-0130 (review): resolves General from the painted list, refreshing
      // it first. `refreshChats` only schedules the 500 ms debounce, so this
      // awaits the real `refreshChats()` closure — never the schedule.
      refreshGeneralTopic: async (groupId) => {
        await refreshChats().catch(() => {});
        return get().chats.find(
          (chat) => chat.groupId === groupId && chat.topic?.isGeneral === true,
        )?.id;
      },
      createTopic: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId ?? groupIds.get(chatId);
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const topic = await api.createTopic(groupId, input);
        await applyTopicRow(topic);
        const row = get().chats.find((entry) => entry.topic?.id === topic.id);
        if (row === undefined) {
          throw new Error('the new topic did not appear in the chat list');
        }
        const me = get().me;
        if (core !== undefined && me !== undefined) {
          await core.joinRoom(row.id, nick(me)).catch(() => {});
        }
        await openHistory(row.id);
        return row.id;
      },
      patchTopic: async (chatId, input) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await api.patchTopic(topicId, input);
        // A deliberate self-archive moves silently: the header already
        // navigates to General itself, so the removed-while-open flow must
        // not add a "no longer available" notice on top of it.
        if (topic.archived && get().activeChatId === chatId) {
          quietArchiveIds.add(chatId);
        }
        await applyTopicRow(topic);
      },
      addTopicAi: async (chatId, aiId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await api.addTopicAi(topicId, aiId);
        await applyTopicRow(topic);
      },
      removeTopicAi: async (chatId, aiId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await api.removeTopicAi(topicId, aiId);
        await applyTopicRow(topic);
      },
      addTopicMember: async (chatId, userId) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await api.addTopicMember(topicId, userId);
        await applyTopicRow(topic);
      },
      removeTopicMember: async (chatId, userId) => {
        const { topicId } = await topicIdFor(chatId);
        // ONE DELETE. A 404 here does not always mean the topic is gone:
        // the server also 404s for a user who is not a member (e.g. a
        // stale member list, or a second click on Remove). Rethrow as-is;
        // the caller re-checks the row via `refreshTopicRow`.
        const topic = await api.removeTopicMember(topicId, userId);
        await applyTopicRow(topic);
      },
      setTopicRoles: async (chatId, input) => {
        const { topicId } = await topicIdFor(chatId);
        const topic = await api.setTopicRoles(topicId, input);
        await applyTopicRow(topic);
      },
      // T-0130 (review): re-reads the chat list and reports whether the
      // topic row is still there, so a member-removal 404 can be told
      // apart from a gone topic (last member removed → archived). A
      // failed refresh throws (instead of reading a stale list as
      // "alive"), so the panel shows the inline removal error.
      refreshTopicRow: async (chatId, topicId) => {
        await refreshChatsOrThrow();
        return !get().chats.some((chat) => chat.id === chatId || chat.topic?.id === topicId);
      },
      leaveTopic: async (chatId) => {
        const me = get().me;
        if (me === undefined) {
          throw new Error('This topic is not available yet.');
        }
        try {
          await get().removeTopicMember(chatId, me.id);
        } catch (error) {
          // Leaving the last seat archives the topic: the server answers
          // 404 `Topic not found`, and the row refreshes itself away — the
          // caller navigates away. Any other 404 (e.g. "not a member")
          // means nothing left to leave either, but the live row must say
          // so: refresh the list first and swallow only when the topic
          // really disappeared from it. Otherwise rethrow, so the caller
          // shows the normal error instead of navigating away.
          if (error instanceof ApiError && error.status === 404) {
            const { topicId } = await topicIdFor(chatId);
            const gone = await get().refreshTopicRow(chatId, topicId);
            if (gone) {
              await refreshChats().catch(() => {});
              return;
            }
          }
          throw error;
        }
      },
      // T-0124: channels share the create/list/refresh flow with groups (the
      // detail carries `kind`, the chat list paints the feed row).
      // T-0164: `visibility: 'public'` + `handle` creates the channel with
      // its directory entry in one transaction.
      createChannel: async (title, memberIds, description, options) => {
        const detail = await api.createGroup({
          title,
          memberIds,
          kind: 'channel',
          ...(description === undefined || description.trim() === ''
            ? {}
            : { description: description.trim() }),
          ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
          ...(options?.handle === undefined ? {} : { handle: options.handle }),
        });
        const [entries, prefs] = await Promise.all([
          api.getChats(),
          api.listChatPrefs().catch(() => [] as ChatPref[]),
        ]);
        rememberGroupIds(entries);
        const previous = get().chats;
        const freshRows = entries.flatMap((entry) => summariesFor(entry));
        const byJid: Record<string, ChatPref> = {};
        for (const pref of prefs) {
          byJid[pref.chatJid.toLowerCase()] = pref;
        }
        set({
          chats: applyChatPrefs(
            sortByRecency(
              freshRows.map((row) => {
                const before = previous.find((chat) => chat.id === row.id);
                return before === undefined
                  ? row
                  : {
                      ...row,
                      ...(before.lastMessage === undefined
                        ? {}
                        : { lastMessage: before.lastMessage }),
                      unread: before.unread,
                      ...(before.online === undefined ? {} : { online: before.online }),
                    };
              }),
            ),
            prefs,
            now().getTime(),
          ),
          chatPrefs: byJid,
        });
        const created = entries.find(
          (entry) => entry.kind === 'group' && entry.groupId === detail.id,
        );
        if (created === undefined) {
          throw new Error('the new channel did not appear in the chat list');
        }
        const me = get().me;
        if (core !== undefined && me !== undefined) {
          await core.joinRoom(created.chatJid, nick(me)).catch(() => {});
        }
        void ensureGroupMembers(created.chatJid);
        await openHistory(created.chatJid);
        return created.chatJid;
      },
      // T-0124: leaving a channel removes the caller's membership through
      // the member route (the same route admins use to remove others). The
      // list refreshes itself away; the caller navigates away.
      leaveChannel: async (chatId) => {
        const groupId = groupIds.get(chatId);
        const me = get().me;
        if (groupId === undefined || me === undefined) {
          throw new Error('This channel is not available yet.');
        }
        await api.removeGroupMember(groupId, me.id);
        await refreshChatsOrThrow();
      },
      // T-0124: promote/demote through the role route (owner only). The
      // detail refreshes, so the panel updates at once; the chat list
      // refreshes too, so the acting device's rows (myRole, counts) match
      // server truth and the composer bar flips. The target's own device
      // converges on the next list refresh (60s poll / focus), like every
      // other membership change in the app.
      changeChannelRole: async (chatId, userId, role) => {
        const groupId = groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This channel is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.changeGroupMemberRole(groupId, userId, role);
        applyGroupDetail(chatId, detail, domain);
        await refreshChatsOrThrow();
      },
      setMembersCanCreateTopics: async (chatId, allowed) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId ?? groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.setMembersCanCreateTopics(groupId, allowed);
        applyGroupDetail(chatId, detail, domain);
      },
      // T-0164: the owner flips a group public (with a handle) or back to
      // private. The detail refreshes from server truth (like the role
      // change), so the panel, the label and the share link update at once.
      setGroupVisibility: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId ?? groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.setGroupVisibility(groupId, input);
        applyGroupDetail(chatId, detail, domain);
        await refreshChatsOrThrow();
      },
      // T-0164: joins a public group with one request, then opens it: the
      // list refreshes (the new membership arrives) and the General chat id
      // resolves from the painted rows, falling back to undefined when the
      // list has not caught up yet (the caller navigates home instead).
      joinPublicGroup: async (groupId) => {
        await api.joinPublicGroup(groupId);
        await refreshChatsOrThrow();
        const opened = get().chats.find(
          (entry) => entry.groupId === groupId && entry.topic?.isGeneral !== false,
        );
        return opened?.id;
      },
      addGroupAi: async (chatId, aiId) => {
        const groupId = groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.addGroupAi(groupId, aiId);
        applyGroupDetail(chatId, detail, domain);
      },
      removeGroupAi: async (chatId, aiId) => {
        const groupId = groupIds.get(chatId);
        const mine = myJid();
        if (groupId === undefined || mine === undefined) {
          throw new Error('This group is not available yet.');
        }
        const domain = mine.slice(mine.indexOf('@') + 1);
        const detail = await api.removeGroupAi(groupId, aiId);
        applyGroupDetail(chatId, detail, domain);
      },
      hasMore: (chatId) => get().historyComplete[chatId] !== true && cursors[chatId] !== undefined,
      openChat: (chatId) => {
        set((state) => ({
          activeChatId: chatId,
          // Opening another chat dismisses the notice (it belongs to the
          // previous view); reopening the same chat keeps it.
          topicNotice: state.topicNotice?.chatId === chatId ? state.topicNotice : undefined,
        }));
        // Navigating away resolves a pending quiet self-archive: the mark
        // exists so the disappearance refresh moves silently, but leaving
        // first means no silent move is wanted — a leaked mark would
        // silence a later, unrelated removal. Drop every mark except one
        // for the chat just opened.
        for (const id of quietArchiveIds) {
          if (id !== chatId) {
            quietArchiveIds.delete(id);
          }
        }
        recordRead(chatId, lastRead[chatId]);
        void ensureGroupMembers(chatId);
        void refreshPinsFor(chatId);
        if (pendingOpenChatId !== undefined && pendingOpenChatId !== chatId) {
          clearSupersededMarker(pendingOpenChatId);
        }
        pendingOpenChatId = chatId;
        void openHistory(chatId);
      },
      retryChats: () => {
        generation += 1;
        const gen = generation;
        set({ chatsState: 'loading' });
        void boot(gen);
      },
      retryHistory: (chatId) => {
        void openHistory(chatId);
      },
      loadOlder,
      pins: (chatId) => get().pinsByChat[chatId] ?? [],
      pinsLoaded: (chatId) => get().pinsReady[chatId] === true,
      loadPins: async (chatId) => {
        await refreshPinsFor(chatId);
      },
      loadChatMedia: async (chatId, tab, before) => {
        const page = await api.listChatMedia({
          chat: chatId,
          type: tab,
          ...(before === undefined ? {} : { before }),
        });
        return sanitizeMediaPage(page);
      },
      canPin: (chatId) => {
        const state = get();
        const chat = state.chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return false;
        }
        // Either side of a DM may pin.
        if (chat.kind === 'dm') {
          return true;
        }
        // A topic manager: a group owner/admin (roles ride the group
        // detail loaded on open), or the topic creator. The creator edge
        // without a manager role is enforced by the server; the menu hides
        // until the detail loads rather than guessing.
        const role = state.groupInfos[chatId]?.members.find(
          (member) => member.userId === state.currentUserId,
        )?.role;
        return role === 'owner' || role === 'admin';
      },
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinMessage: async (chatId, messageId) => {
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined) {
          throw new Error('Message not found');
        }
        const kind: Pin['kind'] =
          message.voice !== undefined
            ? 'voice'
            : message.image !== undefined ||
                (message.attachment !== undefined && message.attachment.kind === 'image')
              ? 'image'
              : message.attachment !== undefined
                ? 'file'
                : message.card !== undefined
                  ? 'card'
                  : 'text';
        const snapshot: PinMessageInput = {
          chat: chatId,
          messageId: message.id,
          senderName: message.senderName.slice(0, 80) || 'Someone',
          ...(kind === 'text' ? { text: (message.text ?? '').slice(0, 300) } : { text: '' }),
          kind,
        };
        const before = get().pinsByChat[chatId] ?? [];
        const optimistic: Pin = {
          ...snapshot,
          id: `pin-local-${message.id}`,
          pinnedBy: get().currentUserId,
          pinnedAt: new Date().toISOString(),
        };
        set((state) => ({
          pinsByChat: {
            ...state.pinsByChat,
            [chatId]: [optimistic, ...(state.pinsByChat[chatId] ?? [])],
          },
          pinsError: undefined,
        }));
        try {
          const saved = await api.pinMessage(snapshot);
          set((state) => ({
            pinsByChat: {
              ...state.pinsByChat,
              [chatId]: (state.pinsByChat[chatId] ?? []).map((pin) =>
                pin.id === optimistic.id ? saved : pin,
              ),
            },
          }));
        } catch (error) {
          set((state) => ({
            pinsByChat: { ...state.pinsByChat, [chatId]: before },
            pinsError: { chatId, message: 'Could not pin the message. Try again.' },
          }));
          throw error;
        }
      },
      unpinMessage: async (chatId, pinId) => {
        const before = get().pinsByChat[chatId] ?? [];
        set((state) => ({
          pinsByChat: {
            ...state.pinsByChat,
            [chatId]: (state.pinsByChat[chatId] ?? []).filter((pin) => pin.id !== pinId),
          },
          pinsError: undefined,
        }));
        try {
          await api.unpinMessage(pinId);
        } catch (error) {
          set((state) => ({
            pinsByChat: { ...state.pinsByChat, [chatId]: before },
            pinsError: { chatId, message: 'Could not unpin the message. Try again.' },
          }));
          throw error;
        }
      },
      pinsPanel: undefined,
      setPinsPanel: (chatId) => set({ pinsPanel: chatId === undefined ? undefined : { chatId } }),
      openAtMessage: async (chatId, messageId) => {
        get().openChat(chatId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        const current = core;
        if (chat === undefined || current === undefined || !canLoadHistory(chat)) {
          const found = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
          if (found === undefined) {
            throw new Error('message_not_found');
          }
          return found;
        }
        // Wait for the opening page when it is still in flight, then page
        // backwards until the message is loaded or history runs out. A
        // stalled wait (false) breaks out to "Message not found".
        for (let pages = 0; pages < MESSAGE_JUMP_MAX_PAGES; pages += 1) {
          const loaded = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
          if (loaded !== undefined) {
            return loaded;
          }
          if (get().historyComplete[chatId] === true) {
            break;
          }
          if (loadingHistory.has(chatId)) {
            if (!(await waitForHistory(chatId))) {
              break;
            }
            continue;
          }
          const cursor = cursors[chatId];
          if (cursor === undefined) {
            if (!(await waitForHistory(chatId))) {
              break;
            }
            continue;
          }
          await loadOlderPage(chatId, cursor);
        }
        const found = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (found === undefined) {
          throw new Error('message_not_found');
        }
        return found;
      },
      react: (chatId, messageId, emoji) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined) {
          return;
        }
        // The local key is alias-resolved; the wire target must be the server
        // id everyone else knows. An unacked message has none yet, so reacting
        // would send a target nobody could match: do nothing until it has one.
        const targetId = aliasRoot(messageId);
        const wireTarget = wireTargetFor(messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const current = get().reactions[chatId]?.targets[targetId]?.[mine]?.emojis ?? [];
        const next = current.includes(emoji)
          ? current.filter((entry) => entry !== emoji)
          : [...current, emoji];
        const apply = (emojis: string[]): void => {
          applyReactionUpdate(chatId, targetId, mine, emojis, now().getTime());
        };
        apply(next);
        currentCore.sendReactions(chatId, coreKind(chat), wireTarget, next).catch(() => {
          // The send failed: undo the optimistic toggle.
          apply(current);
        });
      },
      startEdit: (chatId, messageId) => {
        set({ editTarget: { chatId, messageId }, actionError: undefined });
      },
      cancelEdit: () => {
        set({ editTarget: undefined });
      },
      editMessage: (chatId, messageId, text) => {
        const trimmed = text.trim();
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined || trimmed.length === 0) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || !canEditMessage(message, get().currentUserId, now())) {
          return;
        }
        // The UI already blocks a no-op edit; the store does too, so no stanza
        // is ever sent for an unchanged text.
        if (message.text === trimmed) {
          return;
        }
        // XEP-0308 names the original by its sender-generated id.
        const wireTarget = correctionTargetFor(messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const targetId = aliasRoot(messageId);
        const author: EditAuthor = { jid: mine, resolved: true };
        const priorMentions = rebaseMentions(message.text ?? '', text, message.mentions ?? []);
        const mentions = mentionsForTrimmedText(text, trimmed, priorMentions);
        const update: EditUpdate = {
          kind: 'correction',
          targetId,
          author,
          text: trimmed,
          order: now().getTime(),
        };
        if (mentions.length > 0) {
          update.mentions = mentions;
        }
        const previous = get().edits[chatId];
        set({ actionError: undefined });
        set((state) => ({
          edits: {
            ...state.edits,
            [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
          },
        }));
        refreshEdits(chatId);
        currentCore
          .sendCorrection(
            chatId,
            coreKind(chat),
            wireTarget,
            trimmed,
            mentions.length === 0
              ? undefined
              : {
                  mentions: mentions.map((mention) => ({
                    jid: mention.jid,
                    begin: mention.begin,
                    end: mention.end,
                  })),
                },
          )
          .catch(() => {
            restoreMessage(chatId, message);
            restoreEdits(chatId, previous);
            set({
              actionError: { chatId, message: 'Could not save the edit. Try again.' },
            });
          });
      },
      deleteForEveryone: (chatId, messageId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const mine = myJid();
        if (chat === undefined || mine === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || !canDeleteMessage(message, get().currentUserId)) {
          return;
        }
        const wireTarget = retractionTargetFor(chat, messageId);
        const currentCore = core;
        if (wireTarget === undefined || currentCore === undefined) {
          return;
        }
        const targetId = aliasRoot(messageId);
        const author: EditAuthor = { jid: mine, resolved: true };
        const update: EditUpdate = {
          kind: 'retraction',
          targetId,
          author,
          order: now().getTime(),
        };
        const previous = get().edits[chatId];
        set({ actionError: undefined });
        set((state) => ({
          edits: {
            ...state.edits,
            [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
          },
        }));
        refreshEdits(chatId);
        currentCore.sendRetraction(chatId, coreKind(chat), wireTarget).catch(() => {
          restoreMessage(chatId, message);
          restoreEdits(chatId, previous);
          set({
            actionError: { chatId, message: 'Could not delete the message. Try again.' },
          });
        });
      },
      sendTyping: (chatId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (core !== undefined && chat !== undefined) {
          core.sendTyping(chatId, coreKind(chat), 'composing');
        }
      },
      // XEP-0357 enable/disable over the user's own session (ejabberd
      // requires it; there is no admin shortcut). Rejects offline or when
      // the core cannot send raw IQs, so the settings page can roll back.
      setPushPair: async (input) => {
        if (core === undefined || core.setPushEnabled === undefined) {
          throw new Error('the chat connection cannot toggle push');
        }
        await core.setPushEnabled(input);
      },
      sendText: (chatId, text, options) => {
        const trimmed = text.trim();
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (trimmed.length === 0 || chat === undefined) {
          return;
        }
        const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: trimmed,
          createdAt: now(),
          status: 'sending',
          ...(mentions.length === 0 ? {} : { mentions }),
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = signatureFor(chatId, trimmed, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        rememberBaseText(localId, trimmed);

        if (core === undefined) {
          return;
        }
        core
          .sendMessage(chatId, coreKind(chat), trimmed, {
            ...(replyTo === undefined ? {} : { replyTo: { id: replyTo.id } }),
            ...(mentions.length === 0
              ? {}
              : {
                  mentions: mentions.map((mention) => ({
                    jid: mention.jid,
                    begin: mention.begin,
                    end: mention.end,
                  })),
                }),
          })
          .then((sent) => {
            linkMessageIds(localId, sent.id);
            linkLocalToServer(localId, sent.id);
            rememberOriginId(localId, sent.id);
            updateMessageStatus(chatId, localId, 'sent');
          })
          .catch(() => {
            // The message stays marked as sending; a reconnect can resend later.
          });
      },
      sendVoice: (chatId, recording, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined || recording.blob.size === 0) {
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const localUrl = objectUrlFor(recording.blob);
        const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: now(),
          status: 'sending',
          voice: {
            duration_ms: Math.max(1, recording.durationMs),
            mime: 'audio/mp4',
            waveform,
            ...(localUrl === undefined ? {} : { url: localUrl }),
          },
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = signatureFor(chatId, '', replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);
        pendingVoices.set(localId, { blob: recording.blob, waveform });
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }

        runVoiceSend(chat, localId, recording.blob, waveform, replyTo);
      },
      retryVoice: (chatId, messageId) => {
        const root = aliasRoot(messageId);
        const kept = pendingVoices.get(root) ?? pendingVoices.get(messageId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (kept === undefined || chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || message.status !== 'failed' || message.voice === undefined) {
          return;
        }
        markSendRetrying(chatId, messageId);
        runVoiceSend(chat, messageId, kept.blob, kept.waveform, message.replyTo);
      },
      deleteFailedMessage: (chatId, messageId) => {
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        if (message === undefined || message.status !== 'failed') {
          return;
        }
        if (message.voice !== undefined) {
          pendingVoices.delete(aliasRoot(messageId));
          pendingVoices.delete(messageId);
        }
        const root = aliasRoot(messageId);
        if (sendTimeoutRuns.has(root)) {
          const pending = sendTimeouts.get(root);
          if (pending !== undefined) {
            clearTimeout(pending.timer);
            sendTimeouts.delete(root);
          }
          sendTimeoutRuns.delete(root);
        }
        removeFailedMessage(chatId, messageId);
      },
      sendAttachment: (chatId, file, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined || file.size === 0) {
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const caption = options?.caption?.trim() ?? '';
        const kind = attachmentPort.classify(file);
        const mime = file.type === '' ? 'application/octet-stream' : file.type;
        const localUrl = kind === 'image' ? objectUrlFor(file) : undefined;
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: now(),
          status: 'sending',
          attachment: {
            kind,
            url: localUrl ?? '',
            name: cleanFilename(file.name),
            size: file.size,
            mime,
          },
          ...(caption.length === 0 ? {} : { text: caption }),
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = signatureFor(chatId, caption, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);
        pendingAttachments.set(localId, file);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        if (caption.length > 0) {
          rememberBaseText(localId, caption);
        }
        runAttachmentUpload(chat, localId, file, caption, replyTo);
      },
      sendSticker: (chatId, sticker, options) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        // The choice may come from tampered localStorage recents or drifted
        // pack rows: validate before the optimistic insert, because
        // `encodePayload` throws synchronously on an invalid payload and
        // would otherwise leave a stuck `sending` bubble with no retry.
        const data = {
          pack_id: sticker.packId,
          sticker_id: sticker.stickerId,
          url: sticker.url,
          ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        };
        if (!StickerSchema.safeParse(data).success) {
          set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
          return;
        }
        sequence += 1;
        const localId = `local-${sequence}`;
        const replyTo = options?.replyTo;
        const body = sticker.emoji ?? '';
        const payload = { v: 0, type: 'sticker', data } as const;
        const message: UiMessage = {
          id: localId,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: body,
          createdAt: now(),
          status: 'sending',
          card: payload,
          ...(replyTo === undefined ? {} : { replyTo }),
        };
        const signature = stickerSignatureFor(chatId, body, sticker.stickerId, replyTo);
        const queue = pendingOutgoing.get(signature) ?? [];
        queue.push(localId);
        pendingOutgoing.set(signature, queue);
        setChatMessage(chatId, message, true);
        const mine = myJid();
        if (mine !== undefined) {
          rememberAuthor(localId, { jid: mine, resolved: true });
        }
        if (body.length > 0) {
          rememberBaseText(localId, body);
        }
        if (core === undefined) {
          markStickerFailed(chatId, localId);
          return;
        }
        runStickerSend(chat, localId, payload, body, replyTo);
      },
      forwardMessages: (targets, messages, options) => {
        const comment = options?.comment?.trim();
        const visited = new Set<string>();
        for (const targetId of targets) {
          if (visited.has(targetId)) {
            continue;
          }
          visited.add(targetId);
          const target = get().chats.find((entry) => entry.id === targetId);
          if (target === undefined) {
            continue;
          }
          let queued = false;
          for (const message of messages) {
            if (
              message.deleted === true ||
              message.failed === true ||
              message.status === 'failed' ||
              message.status === 'sending'
            ) {
              continue;
            }
            const origin = forwardOriginFor(message);
            if (origin === undefined) {
              continue;
            }
            const payload = forwardedPayloadFor(message);
            const body = message.text ?? '';
            if (body.length === 0 && payload === undefined) {
              continue;
            }
            sequence += 1;
            const localId = `local-${sequence}`;
            const copy: UiMessage = {
              id: localId,
              chatId: targetId,
              senderId: get().currentUserId,
              senderName: 'You',
              createdAt: now(),
              status: 'sending',
              forward: origin,
              ...(body.length === 0 ? {} : { text: body }),
              ...(payload === undefined ? {} : forwardedUiFieldsFor(payload)),
            };
            // Key the echo queue exactly as the matching normal send does, so
            // the server echo links to this bubble instead of duplicating it.
            const signature =
              payload !== undefined && payload.type === 'sticker'
                ? stickerSignatureFor(targetId, body, payload.data.sticker_id, undefined)
                : signatureFor(targetId, body, undefined);
            const queue = pendingOutgoing.get(signature) ?? [];
            queue.push(localId);
            pendingOutgoing.set(signature, queue);
            setChatMessage(targetId, copy, true);
            const mine = myJid();
            if (mine !== undefined) {
              rememberAuthor(localId, { jid: mine, resolved: true });
            }
            if (body.length > 0) {
              rememberBaseText(localId, body);
            }
            queued = true;
            runForwardSend(target, localId, body, payload, origin);
          }
          // The comment is a separate normal text message, only when this
          // target received at least one copy.
          if (queued && comment !== undefined && comment.length > 0) {
            get().sendText(targetId, comment);
          }
        }
      },
      retrySticker: (chatId, messageId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        const payload =
          message?.card !== undefined && message.card.type === 'sticker' ? message.card : undefined;
        if (message === undefined || payload === undefined) {
          return;
        }
        if (!StickerSchema.safeParse(payload.data).success) {
          markStickerFailed(chatId, messageId);
          return;
        }
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: listFor(state, chatId).map((item) =>
              sameMessage(item.id, messageId) ? clearFailure(item) : item,
            ),
          },
        }));
        runStickerSend(chat, messageId, payload, message.text ?? '', message.replyTo);
      },
      retryAttachment: (chatId, messageId) => {
        const root = aliasRoot(messageId);
        const file = pendingAttachments.get(root) ?? pendingAttachments.get(messageId);
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (file === undefined || chat === undefined) {
          return;
        }
        const message = listFor(get(), chatId).find((item) => sameMessage(item.id, messageId));
        // Like `retryVoice`: only a `failed` bubble may relaunch the pipeline,
        // so a double Retry click cannot double-send (the first click flips
        // the bubble back to `sending`, and the second returns here).
        if (message === undefined || message.status !== 'failed') {
          return;
        }
        markSendRetrying(chatId, messageId);
        runAttachmentUpload(chat, messageId, file, message.text ?? '', message.replyTo);
      },
      createGroup: async (title, memberIds, options) => {
        // T-0124: channels share this entry point (the dialog passes `kind`
        // and `description` through the same call). The detail carries
        // `kind`, and the chat list paints the feed row.
        // T-0164: `visibility: 'public'` + `handle` creates the group with
        // its directory entry in one transaction.
        const detail = await api.createGroup({
          title,
          memberIds,
          ...(options?.kind === undefined ? {} : { kind: options.kind }),
          ...(options?.description === undefined ? {} : { description: options.description }),
          ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
          ...(options?.handle === undefined ? {} : { handle: options.handle }),
        });
        const [entries, prefs] = await Promise.all([
          api.getChats(),
          api.listChatPrefs().catch(() => [] as ChatPref[]),
        ]);
        rememberGroupIds(entries);
        const previous = get().chats;
        const freshRows = entries.flatMap((entry) => summariesFor(entry));
        const byJid: Record<string, ChatPref> = {};
        for (const pref of prefs) {
          byJid[pref.chatJid.toLowerCase()] = pref;
        }
        set({
          chats: applyChatPrefs(
            sortByRecency(
              freshRows.map((row) => {
                const before = previous.find((chat) => chat.id === row.id);
                return before === undefined
                  ? row
                  : {
                      ...row,
                      ...(before.lastMessage === undefined
                        ? {}
                        : { lastMessage: before.lastMessage }),
                      unread: before.unread,
                      ...(before.online === undefined ? {} : { online: before.online }),
                    };
              }),
            ),
            prefs,
            now().getTime(),
          ),
          chatPrefs: byJid,
        });
        const created = entries.find(
          (entry) => entry.kind === 'group' && entry.groupId === detail.id,
        );
        if (created === undefined) {
          throw new Error('the new group did not appear in the chat list');
        }
        const me = get().me;
        if (core !== undefined && me !== undefined) {
          await core.joinRoom(created.chatJid, nick(me)).catch(() => {});
        }
        void ensureGroupMembers(created.chatJid);
        await openHistory(created.chatJid);
        return created.chatJid;
      },
      createInvite: async () => {
        const invite = await api.createInvite();
        return invite.url;
      },
      signOut: async () => {
        get().stop();
        clearChatListCache(storage);
        resetIsServerOwnerCache();
        // A new sign-in is a new session for the handle gate: clear every
        // dismissal so the next user is asked again.
        resetHandleGateDismissal();
        cachedUserId = undefined;
        lastRead = {};
        if (storage !== null && lastReadUserId !== undefined) {
          try {
            storage.removeItem(`${LAST_READ_PREFIX}${lastReadUserId}`);
          } catch {
            // Ignore storage failures on the way out.
          }
        }
        set({
          currentUserId: '',
          me: undefined,
          status: 'offline',
          chatsState: 'loading',
          historyState: {},
          chats: [],
          contacts: [],
          chatPrefs: {},
          defaultBackground: null,
          messagesByChat: {},
          reactions: {},
          edits: {},
          pinsByChat: {},
          pinsReady: {},
          pinsPanel: undefined,
          pinsError: undefined,
          editTarget: undefined,
          actionError: undefined,
          mediaTrustedHosts: undefined,
          activeChatId: undefined,
          historyComplete: {},
          groupInfos: {},
          typing: {},
          drafts: {},
          finishedDraftMessages: {},
          search: '',
          searchChat: undefined,
          activeFolder: 'all',
          folders: [],
        });
        groupMembers.clear();
        groupInfos.clear();
        messageAuthors.clear();
        messageOriginIds.clear();
        messageBaseTexts.clear();
        try {
          await authClient.signOut();
        } catch {
          // The app still clears local state even if sign-out fails.
        }
        goToLogin();
      },
      start: () => {
        generation += 1;
        if (get().chats.length === 0) {
          const cached = readChatListCache(storage);
          if (cached === null) {
            set({ chatsState: 'loading' });
          } else {
            // Paint the last list at once; boot replaces it with fresh data.
            cachedUserId = cached.userId;
            set({ chats: cached.chats, chatsState: 'ready' });
          }
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('pagehide', saveChatList);
        }
        void boot(generation);
      },
      stop: () => {
        generation += 1;
        closeDraftStream?.();
        closeDraftStream = undefined;
        stopChatsPolling();
        stopPinsPolling();
        clearDraftState();
        set({ drafts: {}, finishedDraftMessages: {}, defaultBackground: null });
        pendingOpenChatId = undefined;
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        unsubscribers = [];
        for (const timer of Object.values(typingTimers)) {
          clearTimeout(timer);
        }
        typingTimers = {};
        for (const pending of sendTimeouts.values()) {
          clearTimeout(pending.timer);
        }
        sendTimeouts.clear();
        sendTimeoutRuns.clear();
        if (refreshTimer !== undefined) {
          clearTimeout(refreshTimer);
          refreshTimer = undefined;
        }
        if (connectRetryTimer !== undefined) {
          clearTimeout(connectRetryTimer);
          connectRetryTimer = undefined;
        }
        connectRetryAttempt = 0;
        groupsJoined = false;
        mediaToken = undefined;
        set({ mediaTrustedHosts: undefined });
        if (typeof window !== 'undefined') {
          window.removeEventListener('pagehide', saveChatList);
        }
        const current = core;
        core = undefined;
        if (current !== undefined) {
          void current.disconnect().catch(() => {});
        }
      },
      setSearch: (value) => set({ search: value }),
      setSearchChat: (chatId) => set({ searchChat: chatId }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      setFolders: (folders) => {
        const sorted = sortFolders(folders);
        set((state) => ({
          folders: sorted,
          activeFolder:
            state.activeFolder === 'all' ||
            sorted.some((folder) => folder.id === state.activeFolder)
              ? state.activeFolder
              : 'all',
        }));
      },
      refreshChatPrefs: async () => {
        const gen = generation;
        let prefs: ChatPref[];
        try {
          prefs = await api.listChatPrefs();
        } catch {
          return;
        }
        if (gen !== generation) {
          return;
        }
        applyPrefs(prefs);
      },
      refreshDefaultBackground: async () => {
        const gen = generation;
        let value: ChatBackgroundChoice;
        try {
          value = await api.getChatBackgroundDefault();
        } catch {
          // A failed load keeps the slate grid; it never blocks the chat list.
          return;
        }
        if (gen !== generation) {
          return;
        }
        set({ defaultBackground: value });
      },
      setPinned: async (chatId, pinned) => {
        await updatePref(chatId, { pinned });
      },
      setMuted: async (chatId, duration) => {
        await updatePref(
          chatId,
          duration === null ? { mutedUntil: null } : { mutedUntil: mutedUntilFor(duration, now()) },
        );
      },
      setArchived: async (chatId, archived) => {
        await updatePref(chatId, { archived });
        saveChatList();
      },
      // T-0462: pick a preset for one chat (null clears the override, so the
      // chat inherits the caller's global default again).
      setChatBackground: async (chatId, presetId) => {
        await updatePref(chatId, {
          backgroundPreset: presetId,
          backgroundImageId: null,
          backgroundDim: null,
        });
      },
      // T-0462: pick the global default. Optimistic with rollback; the picker
      // paints at once and the saved default replaces the optimistic value.
      setDefaultBackground: async (presetId) => {
        const previous = get().defaultBackground;
        const optimistic: ChatBackgroundChoice = {
          backgroundPreset: presetId,
          backgroundImageId: null,
          backgroundDim: null,
        };
        set({ defaultBackground: optimistic });
        let saved: ChatBackgroundChoice;
        try {
          saved = await api.putChatBackgroundDefault(optimistic);
        } catch (error) {
          set({ defaultBackground: previous });
          throw error;
        }
        set({ defaultBackground: saved });
      },
      // T-0464: pick an uploaded image for one chat, with the dim percentage.
      // `updatePref` patches the row optimistically and rolls back on failure.
      setChatBackgroundImage: async (chatId, imageId, dim) => {
        await updatePref(chatId, {
          backgroundPreset: null,
          backgroundImageId: imageId,
          backgroundDim: dim,
        });
      },
      // T-0464: pick an uploaded image as the global default, optimistic with
      // rollback like the preset setter above.
      setDefaultBackgroundImage: async (imageId, dim) => {
        const previous = get().defaultBackground;
        const optimistic: ChatBackgroundChoice = {
          backgroundPreset: null,
          backgroundImageId: imageId,
          backgroundDim: dim,
        };
        set({ defaultBackground: optimistic });
        let saved: ChatBackgroundChoice;
        try {
          saved = await api.putChatBackgroundDefault(optimistic);
        } catch (error) {
          set({ defaultBackground: previous });
          throw error;
        }
        set({ defaultBackground: saved });
      },
      archivedChats: () =>
        sortByRecency(
          get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
        ),
    };
  });
}
