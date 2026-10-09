import type {
  ChatSummary,
  EditsState,
  MentionMember,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
} from '@zilar/chat-core';
import { folderMatches, folderUnreadTotal } from '@zilar/chat-core';
import type { ChatFolder } from '@zilar/chat-core';
import type {
  ChatBackgroundChoice,
  ChatPref,
  Contact,
  CreateTopicInput,
  GroupBackground,
  GroupDetail,
  Me,
  MediaPage,
  MediaTab,
  PatchTopicInput,
  Pin,
  PublicAi,
  SetGroupListenerInput,
  SetTopicRolesInput,
} from '@/lib/api';
import {
  MUTE_DURATIONS,
  applyChatPrefs,
  effectivePrefFor,
  mutedUntilFor,
  sortPinnedFirst,
} from '@/lib/chatPrefs';
import type { MuteDurationId } from '@/lib/chatPrefs';

// The in-memory mock store lives in `mockStore.ts`; re-exported so every
// existing import of `createChatStore` keeps working.
export { createChatStore } from './mockStore';
export type { ChatStoreSeed } from './mockStore';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

/** Whether the chat list has arrived: `loading` until the first
 * successful `/api/chats` merge, `error` when that first load fails. */
export type ChatsState = 'loading' | 'ready' | 'error';

/** Whether a chat's first history page has arrived. */
export type HistoryState = 'loading' | 'ready' | 'error';

export interface TypingState {
  names: string[];
}

/** The live AI draft of one chat: the latest cumulative reply text. */
export interface DraftState {
  turnId: string;
  text: string;
}

export interface SendTextOptions {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
}

/** A finished recording on its way to the server and then to XEP-0363. */
export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  waveform: number[];
}

/** What the composer passes when it sends a file or image attachment. */
export interface SendAttachmentOptions {
  caption?: string;
  replyTo?: ReplyRef;
}

/** What the sticker panel passes when it sends a sticker (T-0120). */
export interface SendStickerInput {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

export interface ChatStore {
  currentUserId: string;
  me: Me | undefined;
  status: ConnectionStatus;
  /** Loading state of the chat list itself. `ready` after the first merge. */
  chatsState: ChatsState;
  /** Per-chat loading state of the first history page. Absent means `ready`. */
  historyState: Record<string, HistoryState>;
  /**
   * Effective first-page state for one chat. The real store reports
   * `loading` when the page was never requested (e.g. first paint before
   * `openChat` runs); the mock store reports `ready` unless seeded otherwise.
   */
  historyStateFor: (chatId: string) => HistoryState;
  /** Re-runs the first chat-list load after a failure. */
  retryChats: () => void;
  /** Reloads the chat list and resolves the group's General topic id. */
  refreshGeneralTopic: (groupId: string) => Promise<string | undefined>;
  /** Re-runs the first history-page load for one chat after a failure. */
  retryHistory: (chatId: string) => void;
  chats: ChatSummary[];
  contacts: Contact[];
  messages: (chatId: string) => UiMessage[];
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
  /**
   * Server chat-preference rows by lowercased chat JID (T-0113). Loaded with
   * the chat list; mute/archive/pin actions patch one row optimistically and
   * roll back on failure.
   */
  chatPrefs: Record<string, ChatPref>;
  /** Loads the caller's pref rows and merges them into the chat list. */
  refreshChatPrefs: () => Promise<void>;
  /** T-0461: the caller's global background default; null until loaded. */
  defaultBackground: ChatBackgroundChoice | null;
  /** Loads the caller's global background default. Never rejects. */
  refreshDefaultBackground: () => Promise<void>;
  /** Pins or unpins a chat/topic. Optimistic with rollback. Rejects on failure. */
  setPinned: (chatId: string, pinned: boolean) => Promise<void>;
  /** Mutes a chat/topic for a duration, or unmutes. Optimistic with rollback. */
  setMuted: (chatId: string, duration: MuteDurationId | null) => Promise<void>;
  /** Archives or unarchives a chat/topic. Optimistic with rollback. */
  setArchived: (chatId: string, archived: boolean) => Promise<void>;
  /** T-0462: picks (or clears) a chat's own background preset. Optimistic. */
  setChatBackground: (chatId: string, presetId: string | null) => Promise<void>;
  /** T-0462: picks (or clears) the caller's global background default.
   *  Optimistic with rollback. */
  setDefaultBackground: (presetId: string | null) => Promise<void>;
  /** T-0464: picks one of the caller's uploaded images for a chat, with the
   *  dim percentage. Optimistic with rollback. */
  setChatBackgroundImage: (chatId: string, imageId: string, dim: number) => Promise<void>;
  /** T-0464: picks an uploaded image as the caller's global default, with the
   *  dim percentage. Optimistic with rollback. */
  setDefaultBackgroundImage: (imageId: string, dim: number) => Promise<void>;
  /** Per-user archived DMs/AI chats/groups (not topics: those hide inside
   *  their group's own Archived toggle), newest activity first. */
  /** Pins of a chat, newest first; empty until `loadPins` resolves. */
  pins: (chatId: string) => Pin[];
  /** Whether the pins of a chat were ever loaded (mock store: always true). */
  pinsLoaded: (chatId: string) => boolean;
  /** Loads the pins of a chat from the server. Never rejects. */
  loadPins: (chatId: string) => Promise<void>;
  /**
   * Loads one page of a chat's media gallery for a tab (T-0434). `before` is
   * the previous page's `next` cursor. Image items on an untrusted host come
   * back without a `url` (the panel shows a file row instead).
   */
  loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>;
  /** Whether the caller may pin in a chat: DMs either side, topics a manager. */
  canPin: (chatId: string) => boolean;
  /** The pin for a message, when the message is pinned. */
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /**
   * Pins a message (snapshot from the loaded message). Optimistic with
   * rollback. Rejects on failure.
   */
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  /** Removes a pin. Optimistic with rollback. Rejects on failure. */
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  /** The pins panel target: which chat's pins are shown, if any. */
  pinsPanel: { chatId: string } | undefined;
  /** Opens or closes the pins panel for a chat. */
  setPinsPanel: (chatId: string | undefined) => void;
  /** The inline error of the last pin or unpin that failed. */
  pinsError: { chatId: string; message: string } | undefined;
  /** Clears the pins error (dismissed by the banner). */
  dismissPinsError: () => void;
  archivedChats: () => ChatSummary[];
  typing: Record<string, TypingState>;
  /**
   * Live AI reply drafts by chat id (the AI's bare JID), from
   * `/api/drafts/stream` (T-0043). Empty when no AI is writing.
   */
  drafts: Record<string, DraftState>;
  /**
   * Message id -> the draft turn it replaced (T-0045). The final message keeps
   * rendering on the draft's key so its reveal continues instead of snapping.
   */
  finishedDraftMessages: Record<string, string>;
  openChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  hasMore: (chatId: string) => boolean;
  /**
   * Opens a chat at one message (message search): loads history until the
   * message is present, then resolves with it. Rejects with
   * `message_not_found` when history runs out first.
   */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendVoice: (chatId: string, recording: VoiceRecording, options?: SendTextOptions) => void;
  sendAttachment: (chatId: string, file: File, options?: SendAttachmentOptions) => void;
  /** Sends a sticker payload in the chat (T-0120). */
  sendSticker: (chatId: string, sticker: SendStickerInput, options?: SendTextOptions) => void;
  /**
   * Forwards `messages` to each target chat (T-0414): one copy per message per
   * target, carrying a `<forward>` origin and the source's reused body/payload.
   * An optional comment is sent as a separate text message after a target's
   * copies. Deleted, failed and still-sending messages are skipped.
   */
  forwardMessages: (
    targets: string[],
    messages: UiMessage[],
    options?: { comment?: string },
  ) => void;
  /** Re-sends a failed sticker. */
  retrySticker: (chatId: string, messageId: string) => void;
  /** Re-runs a failed attachment upload, keeping the original file. */
  retryAttachment: (chatId: string, messageId: string) => void;
  /** Re-runs a failed voice send from the retained recording (T-0168). */
  retryVoice: (chatId: string, messageId: string) => void;
  /** Removes a failed local bubble; the send never reached the server (T-0168). */
  deleteFailedMessage: (chatId: string, messageId: string) => void;
  /**
   * Toggles my reaction of `emoji` on a message and sends my complete set
   * (XEP-0444). Optimistic; it reverts when the send fails.
   */
  react: (chatId: string, messageId: string, emoji: string) => void;
  /**
   * The message currently being edited, if any. The composer shows an edit bar
   * for it and Enter saves the new text.
   */
  editTarget: { chatId: string; messageId: string } | undefined;
  /** Starts editing a message (cancels any reply); the composer takes over. */
  startEdit: (chatId: string, messageId: string) => void;
  /** Leaves edit mode without saving. */
  cancelEdit: () => void;
  /**
   * Saves an edit (XEP-0308): the new text is applied optimistically and sent,
   * and reverted when the send fails. An unchanged or empty text sends nothing.
   */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /**
   * Deletes a message for everyone (XEP-0424). Optimistic, reverted on a send
   * error.
   */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** The inline error of the last edit or delete that failed to send. */
  actionError: { chatId: string; message: string } | undefined;
  /**
   * Enables or disables the push pair over the XMPP session (XEP-0357).
   * Rejects when the chat connection is offline or cannot send raw IQs.
   */
  setPushPair: (input: { pushJid: string; node: string; enable: boolean }) => Promise<void>;
  /**
   * Hostnames attachment media may auto-load from (T-0065 round 1, T-0122):
   * the XMPP service host, the XMPP domain and `upload.<domain>`. The real
   * store sets it on connect; the mock store leaves it undefined and the
   * renderer treats unknown hosts as untrusted.
   */
  mediaTrustedHosts: ReadonlySet<string> | undefined;
  sendTyping: (chatId: string) => void;
  createGroup: (
    title: string,
    memberIds: string[],
    options?: {
      kind?: 'group' | 'channel';
      description?: string;
      visibility?: 'private' | 'public';
      handle?: string;
    },
  ) => Promise<string>;
  createInvite: () => Promise<string>;
  signOut: () => Promise<void>;
  start: () => void;
  stop: () => void;
  search: string;
  setSearch: (value: string) => void;
  /** Scopes message search to one chat ("Search only in this chat"). */
  searchChat: string | undefined;
  setSearchChat: (chatId: string | undefined) => void;
  /** 'all' or a folder id; folders arrive from /api/chat-folders (T-0237). */
  activeFolder: string;
  setActiveFolder: (folder: string) => void;
  /** Folders from the server, sorted by position; `[]` until synced. */
  folders: ChatFolder[];
  setFolders: (folders: ChatFolder[]) => void;
}

export type ChatStoreState = ChatStore & {
  messagesByChat: Record<string, UiMessage[]>;
  /**
   * Pinned messages by chat id, newest first (T-0114). The real store fills
   * them from `/api/pins`; the mock store keeps them in memory through the
   * mock API.
   */
  pinsByChat: Record<string, Pin[]>;
  /** Chat ids whose pins were ever loaded (real store only). */
  pinsReady: Record<string, boolean>;
  /**
   * XEP-0444 reaction updates by chat id, keyed by the alias-resolved target
   * message id. Kept even for targets that are not loaded yet.
   */
  reactions: Record<string, ReactionsState>;
  /**
   * XEP-0308/0424 edit state by chat id, keyed by the alias-resolved target
   * message id. The mock store keeps the flags on the messages instead and
   * leaves this empty.
   */
  edits: Record<string, EditsState>;
  activeChatId: string | undefined;
  historyComplete: Record<string, boolean>;
  /** Group details (people + AIs) by chat id, for the info panel. */
  groupInfos: Record<string, GroupDetail>;
};

/** True when the chat belongs to the active folder: `undefined` (unknown id)
 * and `'all'` both match everything, like the old hard-coded All tab. */
export function matchesFolder(chat: ChatSummary, folder: ChatFolder | undefined): boolean {
  if (folder === undefined) {
    return true;
  }
  return folderMatches(folder, chat);
}

function activeFolderOf(state: ChatStoreState): ChatFolder | undefined {
  if (state.activeFolder === 'all') {
    return undefined;
  }
  return state.folders.find((folder) => folder.id === state.activeFolder);
}

export function visibleChats(state: ChatStoreState): ChatSummary[] {
  const query = state.search.trim().toLowerCase();
  // Unused by the list itself (it renders `groupChats`), but kept for callers
  // that need the flat visible rows: per-user archived DMs/AIs are out (they
  // live in the Archived list); topics stay, grouped or filtered by search.
  return state.chats.filter((chat) => {
    if (chat.topic === undefined && chat.archived === true) {
      return false;
    }
    if (!matchesFolder(chat, activeFolderOf(state))) {
      return false;
    }
    return (
      query.length === 0 ||
      chat.title.toLowerCase().includes(query) ||
      (chat.groupTitle !== undefined && chat.groupTitle.toLowerCase().includes(query))
    );
  });
}

/**
 * One sidebar group (T-0111): the group's title plus its topic rows. DMs and
 * AI chats are singleton groups with a stable key.
 */
export interface ChatGroup {
  key: string;
  title: string;
  /** The group's id for avatar + collapse state; undefined for DMs/AIs. */
  groupId: string | undefined;
  /** T-0165: the group's picture, from its first topic row. */
  avatarUrl?: string | undefined;
  topics: ChatSummary[];
}

function groupTitleOf(chat: ChatSummary): string {
  return chat.groupTitle ?? chat.title;
}

/**
 * Folds the flat chat list into sidebar groups: every topic of a group nests
 * under its group header; DMs and AI chats stand alone. Per-user archived
 * chats are hidden here (they live in the Archived section). Pinned singles
 * and pinned groups (via the General room's pref) float to the top, newer
 * pins first; inside a group, pinned topics float above the rest with
 * General first among the unpinned. Search keeps a group header when any of
 * its topics matches by name, or when the group's own name contains the
 * query (then it shows all its topics). Folders treat a topic like its group (a topic
 * matches when its own row does).
 */
export function groupChats(state: ChatStoreState): ChatGroup[] {
  const query = state.search.trim().toLowerCase();
  const byGroup = new Map<string, ChatSummary[]>();
  const singles: ChatSummary[] = [];
  for (const chat of state.chats) {
    // Manager-archived topics never reach the client (the server excludes
    // them); per-user archived topics stay in their group so the group's own
    // Archived toggle shows them. Per-user archived DMs/AIs live in the
    // bottom Archived list instead.
    if (chat.topic === undefined && chat.archived === true) {
      continue;
    }
    if (!matchesFolder(chat, activeFolderOf(state))) {
      continue;
    }
    if (chat.topic !== undefined && chat.groupId !== undefined) {
      const list = byGroup.get(chat.groupId) ?? [];
      list.push(chat);
      byGroup.set(chat.groupId, list);
    } else {
      if (query.length > 0 && !chat.title.toLowerCase().includes(query)) {
        continue;
      }
      singles.push(chat);
    }
  }
  const groups: ChatGroup[] = [];
  for (const [groupId, topics] of byGroup) {
    const groupMatches = query.length > 0 && groupTitleOf(topics[0]!).toLowerCase().includes(query);
    const matching =
      query.length === 0 || groupMatches
        ? topics
        : topics.filter((topic) => topic.title.toLowerCase().includes(query));
    if (matching.length === 0) {
      continue;
    }
    const title = groupTitleOf(matching[0] ?? topics[0]!);
    groups.push({
      key: `group:${groupId}`,
      title,
      groupId,
      // T-0165: every topic row carries the group's picture, so the first
      // one paints the header.
      ...(matching[0]?.avatarUrl === undefined ? {} : { avatarUrl: matching[0].avatarUrl }),
      topics: sortTopics(matching),
    });
  }
  for (const chat of singles) {
    groups.push({ key: `chat:${chat.id}`, title: chat.title, groupId: undefined, topics: [chat] });
  }
  return sortGroupsPinnedFirst(groups);
}

// A group's pin stamp: the General topic's (the pref lives on the General
// room JID). A singleton group's is its own row's.
function groupPinTime(group: ChatGroup): number {
  const general = group.topics.find((topic) => topic.topic?.isGeneral === true);
  const row = general ?? group.topics[0];
  return row?.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortGroupsPinnedFirst(groups: ChatGroup[]): ChatGroup[] {
  if (!groups.some((group) => groupPinTime(group) !== Number.NEGATIVE_INFINITY)) {
    return groups;
  }
  return [...groups].sort((left, right) => {
    const time = groupPinTime(right) - groupPinTime(left);
    return time !== 0 ? time : left.title.localeCompare(right.title);
  });
}

function topicTime(chat: ChatSummary): number {
  return chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortTopics(topics: ChatSummary[]): ChatSummary[] {
  return [...topics].sort((left, right) => {
    const leftPinned = left.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightPinned = right.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    // Pinned topics float above the rest (newer pins first); General stays
    // first among the unpinned, then the rest by recency.
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    if (leftPinned !== Number.NEGATIVE_INFINITY) {
      return left.title.localeCompare(right.title);
    }
    const leftGeneral = left.topic?.isGeneral === true;
    const rightGeneral = right.topic?.isGeneral === true;
    if (leftGeneral !== rightGeneral) {
      return leftGeneral ? -1 : 1;
    }
    return topicTime(right) - topicTime(left) || left.title.localeCompare(right.title);
  });
}

export function folderUnread(state: ChatStoreState, folderId: string): number {
  if (folderId === 'all') {
    return folderUnreadTotal('all', state.chats);
  }
  const folder = state.folders.find((entry) => entry.id === folderId);
  if (folder === undefined) {
    return 0;
  }
  return folderUnreadTotal(folder, state.chats);
}

export { MUTE_DURATIONS, applyChatPrefs, effectivePrefFor, mutedUntilFor, sortPinnedFirst };
export type { MuteDurationId };
