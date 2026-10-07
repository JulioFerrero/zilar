import type {
  ChatSummary,
  EditsState,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
} from '@zilar/chat-core';
import {
  folderMatches,
  folderUnreadTotal,
  mentionsForTrimmedText,
  rebaseMentions,
  canEditMessage,
  canDeleteMessage,
  sortFolders,
  splitLinks,
} from '@zilar/chat-core';
import type { ChatFolder } from '@zilar/chat-core';
import type {
  ChatBackgroundChoice,
  ChatPref,
  Contact,
  CreateTopicInput,
  GroupBackground,
  GroupDetail,
  Me,
  MediaItem,
  MediaPage,
  MediaTab,
  PatchTopicInput,
  Pin,
  PinMessageInput,
  PublicAi,
  SetGroupListenerInput,
  SetTopicRolesInput,
  Topic,
} from '@/lib/api';
import {
  addTopicAi,
  addTopicMember,
  ApiError,
  createTopic,
  getChatBackgroundDefault,
  listChatPrefs,
  patchTopic,
  putChatBackgroundDefault,
  putChatPref,
  removeTopicAi,
  removeTopicMember,
  setGroupVisibility as setGroupVisibilityApi,
  setMembersCanCreateTopics,
  setGroupBackground as setGroupBackgroundApi,
  setGroupListener as setGroupListenerApi,
  setTopicRoles,
} from '@/lib/api';
import {
  MUTE_DURATIONS,
  applyChatPrefs,
  effectivePrefFor,
  mutedUntilFor,
  sortPinnedFirst,
} from '@/lib/chatPrefs';
import type { MuteDurationId } from '@/lib/chatPrefs';
import { classify, cleanFilename, objectUrlFor } from '@/lib/attachments';
import { StickerSchema, isValid } from '@zilar/protocol';
import { sampleVoiceDataUrl } from '@/lib/voice';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import {
  currentUserId as defaultCurrentUserId,
  mockChats,
  mockGroupDetails,
  mockGroupMembers,
  mockMessages,
  mockOwnedAis,
  MOCK_TOPIC_NOT_FOUND,
  mockTopicChats,
  mockTopicMessages,
} from '@/mock';

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

export interface ChatStoreSeed {
  currentUserId?: string;
  me?: Me;
  status?: ConnectionStatus;
  chatsState?: ChatsState;
  historyState?: Record<string, HistoryState>;
  contacts?: Contact[];
  chats?: ChatSummary[];
  messagesByChat?: Record<string, UiMessage[]>;
  /** Group details for the mock store; falls back to the bundled mock groups. */
  groupInfos?: Record<string, GroupDetail>;
  /** The AIs the mock user owns, for the add picker; falls back to the bundle. */
  ownedAis?: PublicAi[];
}

function cloneMessages(source: Record<string, UiMessage[]>): Record<string, UiMessage[]> {
  return Object.fromEntries(
    Object.entries(source).map(([chatId, messages]) => [chatId, messages.map(withPlayableVoice)]),
  );
}

// The mock data has no real audio. Give every voice message a synthesized tone
// so the player in the bubble is genuinely usable during UI work and screenshots.
function withPlayableVoice(message: UiMessage): UiMessage {
  if (message.voice === undefined || message.voice.url !== undefined) {
    return message;
  }
  return {
    ...message,
    voice: { ...message.voice, url: sampleVoiceDataUrl(message.voice.duration_ms) },
  };
}

function withLastMessage(chats: ChatSummary[], chatId: string, message: UiMessage): ChatSummary[] {
  return chats.map((chat) =>
    chat.id === chatId ? { ...chat, lastMessage: message, unread: 0 } : chat,
  );
}

// Replaces the chat-list preview only when it is the message that changed, so
// editing or deleting an older message never moves the preview.
function withReplacedLastMessage(
  chats: ChatSummary[],
  chatId: string,
  message: UiMessage,
): ChatSummary[] {
  return chats.map((chat) =>
    chat.id === chatId && chat.lastMessage?.id === message.id
      ? { ...chat, lastMessage: message }
      : chat,
  );
}

// Whether the mock user may pin in a chat (T-0114): anyone in a DM, a
// group owner/admin in a topic or legacy group. Mirrors the server's
// manager rule, minus the topic-creator edge (the mock bundle has no
// creator ids to compare).
function mockCanPin(state: ChatStoreState, chatId: string): boolean {
  const chat = state.chats.find((entry) => entry.id === chatId);
  if (chat === undefined) {
    return false;
  }
  if (chat.kind === 'dm') {
    return true;
  }
  const info = state.groupInfos[chatId];
  const role = info?.members.find((member) => member.userId === state.currentUserId)?.role;
  return role === 'owner' || role === 'admin';
}

// The pin snapshot for a loaded message (T-0114): sender name plus up to 300
// chars of text, or the attachment kind with empty text.
function mockPinSnapshot(
  state: ChatStoreState,
  chatId: string,
  messageId: string,
): Omit<PinMessageInput, 'chat' | 'messageId'> {
  const message = (state.messagesByChat[chatId] ?? []).find((item) => item.id === messageId);
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
  const text = kind === 'text' ? (message.text ?? '').slice(0, 300) : '';
  return { senderName: message.senderName.slice(0, 80) || 'Someone', text, kind };
}

// The mock media gallery page size (T-0434). The mock bundle is small, so the
// first page is always the last: `next` is null.
const MOCK_MEDIA_PAGE_SIZE = 50;

function mockLinkHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// One mock message as zero or more media items for the active tab. Images go
// to `media`, files to `files`, voice to `voice`, and links found in the text
// to `links`, mirroring the server indexer's extraction.
function mockMediaItems(message: UiMessage, chatId: string, tab: MediaTab): MediaItem[] {
  const base = {
    messageId: message.id,
    chat: chatId,
    at: message.createdAt.toISOString(),
    senderName: message.senderName,
  };
  const attachment = message.attachment;
  if (tab === 'media') {
    if (attachment?.kind === 'image') {
      return [
        {
          ...base,
          kind: 'image',
          url: attachment.url,
          name: attachment.name,
          size: attachment.size,
          mime: attachment.mime,
          ...(attachment.width === undefined ? {} : { width: attachment.width }),
          ...(attachment.height === undefined ? {} : { height: attachment.height }),
        },
      ];
    }
    if (message.image !== undefined) {
      return [
        {
          ...base,
          kind: 'image',
          url: message.image.url,
          width: message.image.width,
          height: message.image.height,
        },
      ];
    }
    return [];
  }
  if (tab === 'files') {
    if (attachment?.kind !== 'file') {
      return [];
    }
    return [
      {
        ...base,
        kind: 'file',
        url: attachment.url,
        name: attachment.name,
        size: attachment.size,
        mime: attachment.mime,
      },
    ];
  }
  if (tab === 'voice') {
    if (message.voice === undefined) {
      return [];
    }
    return [
      {
        ...base,
        kind: 'voice',
        ...(message.voice.url === undefined ? {} : { url: message.voice.url }),
        mime: message.voice.mime,
        durationMs: message.voice.duration_ms,
        waveform: message.voice.waveform,
      },
    ];
  }
  const items: MediaItem[] = [];
  for (const segment of splitLinks(message.text ?? '')) {
    if (segment.kind !== 'link') {
      continue;
    }
    items.push({
      ...base,
      kind: 'link',
      linkUrl: segment.href,
      linkHost: mockLinkHost(segment.href),
    });
  }
  return items;
}

function mockMediaPage(state: ChatStoreState, chatId: string, tab: MediaTab): MediaPage {
  const newestFirst = [...(state.messagesByChat[chatId] ?? [])].reverse();
  const items: MediaItem[] = [];
  for (const message of newestFirst) {
    if (message.deleted === true) {
      continue;
    }
    items.push(...mockMediaItems(message, chatId, tab));
  }
  return { items: items.slice(0, MOCK_MEDIA_PAGE_SIZE), next: null };
}

// Toggles my reaction on a mock message. Mock data carries the chips directly
// instead of a separate reaction state, so this works on the message itself.
function withToggledReaction(message: UiMessage, emoji: string, name: string): UiMessage {
  const reactions = (message.reactions ?? []).map((reaction) => ({ ...reaction }));
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
  if (index === -1) {
    reactions.push({ emoji, count: 1, mine: true, reactors: [name] });
  } else {
    const reaction = reactions[index];
    if (reaction !== undefined) {
      if (reaction.mine) {
        const count = reaction.count - 1;
        const reactors = reaction.reactors.filter((reactor) => reactor !== name);
        if (count <= 0) {
          reactions.splice(index, 1);
        } else {
          reactions[index] = { ...reaction, count, mine: false, reactors };
        }
      } else {
        reactions[index] = {
          ...reaction,
          count: reaction.count + 1,
          mine: true,
          reactors: [...reaction.reactors, name],
        };
      }
    }
  }
  const next: UiMessage = { ...message };
  if (reactions.length === 0) {
    delete next.reactions;
  } else {
    next.reactions = reactions;
  }
  return next;
}

// The people and AIs of a group as mention members. Handles pass through
// from the detail (T-0169); AIs have none. The mock domain is fixed; the
// real store builds each JID from the signed-in user's domain.
function mentionMembersFor(detail: GroupDetail): MentionMember[] {
  return [
    ...detail.members.map((member) => ({
      jid: `${member.userId.toLowerCase()}@zilar.test`,
      name: member.name,
      ...(member.handle == null || member.handle === '' ? {} : { handle: member.handle }),
    })),
    ...detail.ais.map((ai) => ({ jid: ai.jid, name: ai.name })),
  ];
}

const TYPING_START_MS = 2000;
const TYPING_DURATION_MS = 4000;

/**
 * Mock typing simulation: Ana and the "Viernes 🍻" group start typing two
 * seconds after the app loads and stop four seconds later.
 */
function scheduleTypingSimulation(set: (partial: Partial<ChatStoreState>) => void): void {
  window.setTimeout(() => {
    set({
      typing: {
        'c-ana': { names: ['Ana'] },
        'c-viernes': { names: ['Luis'] },
      },
    });
  }, TYPING_START_MS);
  window.setTimeout(() => {
    set({ typing: {} });
  }, TYPING_START_MS + TYPING_DURATION_MS);
}

// T-0111: the mock "Dev team" group carries the mockup's topics. The legacy
// single `c-devteam` row is replaced by its topics (General keeps `c-devteam`
// so old deep links open it). Every other chat stays untouched.
function withMockTopics(chats: ChatSummary[]): ChatSummary[] {
  const topics = mockTopicChats();
  if (topics.length === 0) {
    return chats;
  }
  const generalId = topics.find((topic) => topic.topic?.isGeneral === true)?.id;
  return chats.flatMap((chat) => {
    if (chat.id !== generalId) {
      return [chat];
    }
    return topics;
  });
}

function withMockTopicMessages(messages: Record<string, UiMessage[]>): Record<string, UiMessage[]> {
  return { ...messages, ...mockTopicMessages() };
}

// T-0111: every mock topic chat shares the Dev team group detail (people +
// AIs), so the topic panel, the strip owner picker and the header role
// checks read the same members as the legacy group row did.
function withMockTopicGroupInfos(infos: Record<string, GroupDetail>): Record<string, GroupDetail> {
  const devteam = infos['c-devteam'];
  if (devteam === undefined) {
    return infos;
  }
  const next = { ...infos };
  for (const topic of mockTopicChats()) {
    if (next[topic.id] === undefined) {
      next[topic.id] = devteam;
    }
  }
  return next;
}

// T-0130: the mock HTTP layer answers topic writes in memory but knows
// nothing of the painted list, so the mock store folds the returned topic
// row into its chats itself. Archived rows drop out at once (the manager
// archive for everyone), everything else upserts by chat id.
function mockChatIdFor(topic: Topic): string {
  return topic.isGeneral ? 'c-devteam' : topic.chatJid;
}

function mockChatFor(topic: Topic, previous: ChatSummary | undefined): ChatSummary {
  const groupTitle = previous?.groupTitle ?? 'Dev team';
  return {
    id: mockChatIdFor(topic),
    title: topic.name,
    kind: 'group',
    isAI: false,
    space: previous?.space ?? 'work',
    unread: previous?.unread ?? 0,
    muted: previous?.muted ?? false,
    ...(previous?.archived === undefined ? {} : { archived: previous.archived }),
    ...(previous?.pinnedAt === undefined ? {} : { pinnedAt: previous.pinnedAt }),
    ...(previous?.lastMessage === undefined ? {} : { lastMessage: previous.lastMessage }),
    memberCount: topic.memberCount,
    onlineCount: previous?.onlineCount ?? 2,
    groupId: 'g-devteam',
    groupTitle,
    topic: {
      id: topic.id,
      glyph: topic.glyph,
      kind: topic.kind,
      status: topic.status,
      visibility: topic.visibility,
      isGeneral: topic.isGeneral,
      archived: topic.archived,
      owner: topic.owner,
      linkUrl: topic.linkUrl,
      linkLabel: topic.linkLabel,
    },
  };
}

function withMockTopicRow(chats: ChatSummary[], topic: Topic): ChatSummary[] {
  if (topic.archived) {
    return chats.filter((chat) => chat.topic?.id !== topic.id);
  }
  const id = mockChatIdFor(topic);
  const previous = chats.find((chat) => chat.id === id);
  const next = mockChatFor(topic, previous);
  return chats.some((chat) => chat.id === id)
    ? chats.map((chat) => (chat.id === id ? next : chat))
    : [...chats, next];
}

function topicIdForChat(chats: ChatSummary[], chatId: string): string {
  const topicId = chats.find((chat) => chat.id === chatId)?.topic?.id;
  if (topicId === undefined) {
    throw new Error('This topic is not available yet.');
  }
  return topicId;
}

export function createChatStore(seed: ChatStoreSeed = {}): StoreApi<ChatStoreState> {
  let sequence = 0;
  // T-0146: topic ids this store instance saw archived through a 200-path
  // row (a 404-path archive records nothing — see `removeTopicMember`).
  // The `leaveTopic` row re-check reads it alongside the painted list.
  const archivedTopicIds = new Set<string>();

  return createStore<ChatStoreState>((set, get) => {
    const setStatus = (chatId: string, messageId: string, status: MessageStatus): void => {
      set((state) => {
        const list = state.messagesByChat[chatId] ?? [];
        let updated: UiMessage | undefined;
        const next = list.map((item) => {
          if (item.id !== messageId) {
            return item;
          }
          updated = { ...item, status };
          return updated;
        });
        return {
          messagesByChat: { ...state.messagesByChat, [chatId]: next },
          chats:
            updated === undefined ? state.chats : withLastMessage(state.chats, chatId, updated),
        };
      });
    };

    scheduleTypingSimulation(set);

    // The mock user's JID, so mention matching and the picker's "not me" filter
    // work in mock mode exactly as they do against the real store.
    const meUserId = seed.currentUserId ?? defaultCurrentUserId;
    const ownedAis = seed.ownedAis ?? mockOwnedAis;
    // T-0111: the mock "Dev team" group carries mockup topics. The legacy
    // single `c-devteam` row is replaced by its topics (General keeps the id
    // so old deep links open it); other groups stay single rows. Seeded chats
    // (tests) win over the bundle.
    const seededChats = seed.chats;
    const baseChats = seededChats ?? withMockTopics(mockChats);
    const seededMessages = seed.messagesByChat;
    const baseMessages = seededMessages ?? withMockTopicMessages(mockMessages);

    return {
      currentUserId: meUserId,
      me:
        seed.me ??
        ({
          id: meUserId,
          email: 'you@zilar.test',
          name: 'You',
          image: null,
          jid: `${meUserId}@zilar.test`,
        } satisfies Me),
      status: seed.status ?? 'online',
      // The mock store has no async loads, so its data is ready immediately.
      chatsState: seed.chatsState ?? 'ready',
      historyState: seed.historyState ?? {},
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'ready',
      retryChats: () => {},
      retryHistory: () => {},
      contacts: seed.contacts ?? [],
      chats: baseChats,
      messagesByChat: cloneMessages(baseMessages),
      reactions: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: seed.groupInfos ?? withMockTopicGroupInfos(mockGroupDetails),
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      refreshChats: () => {},
      refreshGeneralTopic: async (groupId) =>
        get().chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true)?.id,
      // T-0130 (review): re-checks one topic row after a 404, so the panel
      // can tell "the topic is gone" from "the member was already gone".
      // The mock list is already the truth, plus archived ids this store
      // instance saw (200-path rows): no fetch, just check the row.
      refreshTopicRow: async (_chatId, topicId) =>
        archivedTopicIds.has(topicId) || !get().chats.some((chat) => chat.topic?.id === topicId),
      // Mock-mode topic actions (T-0130): the mock HTTP layer already
      // implements every topic route in memory, so these go through the
      // same api client the dialog, the strip and the panel use, then fold
      // the returned topic row into the painted list. The mock store has no
      // XMPP core, so no room is joined: messages already render from the
      // in-memory bundle.
      createTopic: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId ?? get().groupInfos[chatId]?.id;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const topic = await createTopic(groupId, input);
        set((state) => ({ chats: withMockTopicRow(state.chats, topic) }));
        return mockChatIdFor(topic);
      },
      patchTopic: async (chatId, input) => {
        const topicId = topicIdForChat(get().chats, chatId);
        const topic = await patchTopic(topicId, input);
        set((state) => ({ chats: withMockTopicRow(state.chats, topic) }));
        // A deliberate self-archive moves silently in the real store (the
        // header navigates itself); the mock store has no refresh flow, so
        // clear any notice that would otherwise linger on General.
        if (topic.archived) {
          set({ topicNotice: undefined });
        }
      },
      addTopicAi: async (chatId, aiId) => {
        const topicId = topicIdForChat(get().chats, chatId);
        await addTopicAi(topicId, aiId);
      },
      removeTopicAi: async (chatId, aiId) => {
        const topicId = topicIdForChat(get().chats, chatId);
        await removeTopicAi(topicId, aiId);
      },
      addTopicMember: async (chatId, userId) => {
        const topicId = topicIdForChat(get().chats, chatId);
        await addTopicMember(topicId, userId);
      },
      removeTopicMember: async (chatId, userId) => {
        const topicId = topicIdForChat(get().chats, chatId);
        const topic = await removeTopicMember(topicId, userId);
        set((state) => ({ chats: withMockTopicRow(state.chats, topic) }));
        // T-0146: the mock API answers the last-seat archive with 404
        // instead of a row, so the painted list never learns the topic is
        // gone. Remember the archived id, so the `leaveTopic` row re-check
        // below can tell "the topic is gone" from "not a member". (Only a
        // 200-path row can set this — a 404-path archive records nothing —
        // so in practice the id lands here only via patch/archive flows;
        // the `leaveTopic` branch below handles the 404 archive directly.)
        if (topic.archived) {
          archivedTopicIds.add(topic.id);
        }
      },
      setTopicRoles: async (chatId, input) => {
        const topicId = topicIdForChat(get().chats, chatId);
        const topic = await setTopicRoles(topicId, input);
        set((state) => ({ chats: withMockTopicRow(state.chats, topic) }));
      },
      leaveTopic: async (chatId) => {
        // Like the real store: a last-seat 404 means the topic archived
        // itself away, so there is nothing left to leave — swallow it and
        // let the caller navigate away. A 404 for any other reason (e.g.
        // "not a member") keeps the row: swallow only when the refreshed
        // list no longer has the topic, and rethrow otherwise so the panel
        // shows the normal error instead of navigating away. The mock API
        // answers the last-seat archive with 404 instead of a row, so the
        // painted list still has the row — but the archived answer itself
        // is the "gone" signal here (the server only archives on the last
        // seat leaving). A "not a member" 404 (row untouched AND the DELETE
        // did not archive) rethrows.
        try {
          await get().removeTopicMember(chatId, get().currentUserId);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            const topicId = topicIdForChat(get().chats, chatId);
            const gone = await get().refreshTopicRow(chatId, topicId);
            if (gone) {
              return;
            }
            // The painted list still has the row, but the mock API told us
            // the topic archived (`Topic not found`): the last seat just
            // left, so there is nothing left to leave either.
            if (error.message === MOCK_TOPIC_NOT_FOUND) {
              set((state) => ({
                chats: state.chats.filter((chat) => chat.topic?.id !== topicId),
              }));
              return;
            }
          }
          throw error;
        }
      },
      createChannel: async () => {
        throw new Error('createChannel is not available in the mock store');
      },
      leaveChannel: async (chatId) => {
        const info = get().groupInfos[chatId];
        if (info === undefined) {
          throw new Error('This channel is not available yet.');
        }
        set((state) => ({
          chats: state.chats.filter((chat) => chat.groupId !== info.id),
        }));
      },
      changeChannelRole: async (chatId, userId, role) => {
        const info = get().groupInfos[chatId];
        if (info === undefined) {
          throw new Error('This channel is not available yet.');
        }
        set((state) => {
          const detail = state.groupInfos[chatId];
          if (detail === undefined) {
            return state;
          }
          return {
            groupInfos: {
              ...state.groupInfos,
              [chatId]: {
                ...detail,
                members: detail.members.map((member) =>
                  member.userId === userId ? { ...member, role } : member,
                ),
              },
            },
          };
        });
      },
      setMembersCanCreateTopics: async (chatId, allowed) => {
        const groupId = get().groupInfos[chatId]?.id;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const updated = await setMembersCanCreateTopics(groupId, allowed);
        set((state) => ({ groupInfos: { ...state.groupInfos, [chatId]: updated } }));
      },
      // T-0466 (mock): the group's shared background goes through the mock
      // API's PATCH and paints every chat of that group, like the real store.
      setGroupBackground: async (chatId, background) => {
        const groupId = get().groupInfos[chatId]?.id;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const updated = await setGroupBackgroundApi(groupId, background);
        const nextBackground = updated.background;
        set((state) => ({
          groupInfos: { ...state.groupInfos, [chatId]: updated },
          chats:
            nextBackground === undefined
              ? state.chats
              : state.chats.map((chat) =>
                  chat.groupId === groupId ? { ...chat, groupBackground: nextBackground } : chat,
                ),
        }));
      },
      // T-0478 (mock): the group's AI listener goes through the mock API's
      // PATCH and refreshes the cached detail, like the real store.
      setGroupListener: async (chatId, input) => {
        const groupId = get().groupInfos[chatId]?.id;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const updated = await setGroupListenerApi(groupId, input);
        set((state) => ({ groupInfos: { ...state.groupInfos, [chatId]: updated } }));
      },
      // T-0164 (mock): visibility flips through the mock API's PATCH, and
      // joining appends the mock user like the mock's link join does.
      setGroupVisibility: async (chatId, input) => {
        const groupId = get().groupInfos[chatId]?.id;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        const updated = await setGroupVisibilityApi(groupId, input);
        set((state) => ({ groupInfos: { ...state.groupInfos, [chatId]: updated } }));
      },
      joinPublicGroup: async () => {
        throw new Error('joinPublicGroup is not available in the mock store');
      },
      chatPrefs: {},
      // Mock mode talks to the in-memory mock API (T-0113): the same merge
      // and update semantics as the real store, re-merging server truth
      // after each write.
      refreshChatPrefs: async () => {
        try {
          const prefs = await listChatPrefs();
          const byJid: Record<string, ChatPref> = {};
          for (const pref of prefs) {
            byJid[pref.chatJid.toLowerCase()] = pref;
          }
          set((state) => ({
            chatPrefs: byJid,
            chats: applyChatPrefs(state.chats, prefs, Date.now()),
          }));
        } catch {
          // Mock prefs are best-effort; the list works without them.
        }
      },
      defaultBackground: null,
      refreshDefaultBackground: async () => {
        try {
          const value = await getChatBackgroundDefault();
          set({ defaultBackground: value });
        } catch {
          // Mock background is best-effort; chats still paint the slate grid.
        }
      },
      setPinned: async (chatId, pinned) => {
        const saved = await putChatPref(chatId, { pinned });
        set((state) => {
          const prefs = { ...state.chatPrefs };
          if (saved === null) {
            delete prefs[chatId.toLowerCase()];
          } else {
            prefs[chatId.toLowerCase()] = saved;
          }
          return {
            chatPrefs: prefs,
            chats: applyChatPrefs(state.chats, Object.values(prefs), Date.now()),
          };
        });
      },
      setMuted: async (chatId, duration) => {
        const saved = await putChatPref(
          chatId,
          duration === null
            ? { mutedUntil: null }
            : { mutedUntil: mutedUntilFor(duration, new Date()) },
        );
        set((state) => {
          const prefs = { ...state.chatPrefs };
          if (saved === null) {
            delete prefs[chatId.toLowerCase()];
          } else {
            prefs[chatId.toLowerCase()] = saved;
          }
          return {
            chatPrefs: prefs,
            chats: applyChatPrefs(state.chats, Object.values(prefs), Date.now()),
          };
        });
      },
      setArchived: async (chatId, archived) => {
        const saved = await putChatPref(chatId, { archived });
        set((state) => {
          const prefs = { ...state.chatPrefs };
          if (saved === null) {
            delete prefs[chatId.toLowerCase()];
          } else {
            prefs[chatId.toLowerCase()] = saved;
          }
          return {
            chatPrefs: prefs,
            chats: applyChatPrefs(state.chats, Object.values(prefs), Date.now()),
          };
        });
      },
      // T-0462: the mock store writes the background override through the same
      // in-memory mock API as the other prefs.
      setChatBackground: async (chatId, presetId) => {
        const saved = await putChatPref(chatId, {
          backgroundPreset: presetId,
          backgroundImageId: null,
          backgroundDim: null,
        });
        set((state) => {
          const prefs = { ...state.chatPrefs };
          if (saved === null) {
            delete prefs[chatId.toLowerCase()];
          } else {
            prefs[chatId.toLowerCase()] = saved;
          }
          return {
            chatPrefs: prefs,
            chats: applyChatPrefs(state.chats, Object.values(prefs), Date.now()),
          };
        });
      },
      setDefaultBackground: async (presetId) => {
        const saved = await putChatBackgroundDefault({
          backgroundPreset: presetId,
          backgroundImageId: null,
          backgroundDim: null,
        });
        set({ defaultBackground: saved });
      },
      // T-0464: the mock store writes an uploaded image with its dim through
      // the same prefs API; the image bytes never travel through here.
      setChatBackgroundImage: async (chatId, imageId, dim) => {
        const saved = await putChatPref(chatId, {
          backgroundPreset: null,
          backgroundImageId: imageId,
          backgroundDim: dim,
        });
        set((state) => {
          const prefs = { ...state.chatPrefs };
          if (saved === null) {
            delete prefs[chatId.toLowerCase()];
          } else {
            prefs[chatId.toLowerCase()] = saved;
          }
          return {
            chatPrefs: prefs,
            chats: applyChatPrefs(state.chats, Object.values(prefs), Date.now()),
          };
        });
      },
      setDefaultBackgroundImage: async (imageId, dim) => {
        const saved = await putChatBackgroundDefault({
          backgroundPreset: null,
          backgroundImageId: imageId,
          backgroundDim: dim,
        });
        set({ defaultBackground: saved });
      },
      archivedChats: () =>
        get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
      // T-0114: pinned messages. The mock talks to the in-memory mock API
      // (like chat prefs above); the single mock user may pin anywhere.
      pinsByChat: {},
      pinsReady: {},
      pinsPanel: undefined,
      pinsError: undefined,
      dismissPinsError: () => set({ pinsError: undefined }),
      setPinsPanel: (chatId) => set({ pinsPanel: chatId === undefined ? undefined : { chatId } }),
      pins: (chatId) => get().pinsByChat[chatId] ?? [],
      pinsLoaded: () => true,
      loadPins: async (chatId) => {
        try {
          const { listPins } = await import('@/lib/api');
          const pins = await listPins(chatId);
          set((state) => ({
            pinsByChat: { ...state.pinsByChat, [chatId]: pins },
            pinsReady: { ...state.pinsReady, [chatId]: true },
          }));
        } catch {
          // Mock pins are best-effort; the chat works without them.
        }
      },
      loadChatMedia: async (chatId, tab) => mockMediaPage(get(), chatId, tab),
      canPin: (chatId) => mockCanPin(get(), chatId),
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinMessage: async (chatId, messageId) => {
        const { pinMessage: pinRequest } = await import('@/lib/api');
        const snapshot = mockPinSnapshot(get(), chatId, messageId);
        const before = get().pinsByChat[chatId] ?? [];
        const optimistic: Pin = {
          id: `pin-local-${Date.now()}`,
          chat: chatId,
          messageId,
          senderName: snapshot.senderName,
          text: snapshot.text,
          kind: snapshot.kind,
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
          const saved = await pinRequest({ chat: chatId, messageId, ...snapshot });
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
        const { unpinMessage: unpinRequest } = await import('@/lib/api');
        const before = get().pinsByChat[chatId] ?? [];
        set((state) => ({
          pinsByChat: {
            ...state.pinsByChat,
            [chatId]: (state.pinsByChat[chatId] ?? []).filter((pin) => pin.id !== pinId),
          },
          pinsError: undefined,
        }));
        try {
          await unpinRequest(pinId);
        } catch (error) {
          set((state) => ({
            pinsByChat: { ...state.pinsByChat, [chatId]: before },
            pinsError: { chatId, message: 'Could not unpin the message. Try again.' },
          }));
          throw error;
        }
      },
      search: '',
      activeFolder: 'all',
      folders: [],
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => {
        const detail = get().groupInfos[chatId];
        return detail === undefined ? (mockGroupMembers[chatId] ?? []) : mentionMembersFor(detail);
      },
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: () => {},
      listMyAis: async () => ownedAis,
      addGroupAi: async (chatId, aiId) => {
        const ai = ownedAis.find((item) => item.id === aiId);
        if (ai === undefined) {
          throw new Error('That AI no longer exists.');
        }
        set((state) => {
          const detail = state.groupInfos[chatId];
          if (detail === undefined || detail.ais.some((item) => item.aiId === aiId)) {
            return state;
          }
          return {
            groupInfos: {
              ...state.groupInfos,
              [chatId]: {
                ...detail,
                ais: [
                  ...detail.ais,
                  { aiId: ai.id, jid: ai.jid, name: ai.name, ownerId: get().currentUserId },
                ],
              },
            },
          };
        });
      },
      removeGroupAi: async (chatId, aiId) => {
        set((state) => {
          const detail = state.groupInfos[chatId];
          if (detail === undefined || !detail.ais.some((item) => item.aiId === aiId)) {
            return state;
          }
          return {
            groupInfos: {
              ...state.groupInfos,
              [chatId]: { ...detail, ais: detail.ais.filter((item) => item.aiId !== aiId) },
            },
          };
        });
      },
      openChat: (chatId) =>
        set((state) => ({
          activeChatId: chatId,
          // Opening another chat dismisses the "topic no longer available"
          // notice (it belongs to the previous view).
          topicNotice: state.topicNotice?.chatId === chatId ? state.topicNotice : undefined,
          chats: state.chats.map((chat) =>
            chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
          ),
        })),
      openAtMessage: async (chatId, messageId) => {
        get().openChat(chatId);
        const found = (get().messagesByChat[chatId] ?? []).find((item) => item.id === messageId);
        if (found === undefined) {
          throw new Error('message_not_found');
        }
        return found;
      },
      loadOlder: () => {},
      hasMore: () => false,
      sendTyping: () => {},
      // Mock mode has no XMPP session, so the enable IQ step is skipped.
      setPushPair: async () => {},
      react: (chatId, messageId, emoji) => {
        set((state) => {
          const list = state.messagesByChat[chatId];
          if (list === undefined) {
            return state;
          }
          if (!list.some((item) => item.id === messageId)) {
            return state;
          }
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) =>
                item.id === messageId ? withToggledReaction(item, emoji, 'You') : item,
              ),
            },
          };
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
        if (trimmed.length === 0) {
          return;
        }
        set((state) => {
          const list = state.messagesByChat[chatId];
          const message = list?.find((item) => item.id === messageId);
          if (list === undefined || message === undefined) {
            return state;
          }
          if (
            !canEditMessage(message, state.currentUserId, new Date()) ||
            message.text === trimmed
          ) {
            return state;
          }
          const mentions = mentionsForTrimmedText(
            text,
            trimmed,
            rebaseMentions(message.text ?? '', text, message.mentions ?? []),
          );
          const edited: UiMessage = { ...message, text: trimmed, edited: true };
          if (mentions.length === 0) {
            delete edited.mentions;
          } else {
            edited.mentions = mentions;
          }
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) => (item.id === messageId ? edited : item)),
            },
            chats: withReplacedLastMessage(state.chats, chatId, edited),
            editTarget: state.editTarget?.messageId === messageId ? undefined : state.editTarget,
          };
        });
      },
      deleteForEveryone: (chatId, messageId) => {
        set((state) => {
          const list = state.messagesByChat[chatId];
          const message = list?.find((item) => item.id === messageId);
          if (list === undefined || message === undefined) {
            return state;
          }
          if (!canDeleteMessage(message, state.currentUserId)) {
            return state;
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
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) => (item.id === messageId ? deleted : item)),
            },
            chats: withReplacedLastMessage(state.chats, chatId, {
              ...deleted,
              text: 'Message deleted',
            }),
          };
        });
      },
      createGroup: async () => {
        throw new Error('createGroup is not available in the mock store');
      },
      createInvite: async () => {
        throw new Error('createInvite is not available in the mock store');
      },
      signOut: async () => {},
      start: () => {},
      stop: () => {},
      sendText: (chatId, text, options) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          return;
        }
        const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: trimmed,
          createdAt: new Date(),
          status: 'sending',
          ...(mentions.length === 0 ? {} : { mentions }),
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: [...(state.messagesByChat[chatId] ?? []), message],
          },
          chats: withLastMessage(state.chats, chatId, message),
        }));
        window.setTimeout(() => setStatus(chatId, message.id, 'sent'), 300);
        window.setTimeout(() => setStatus(chatId, message.id, 'read'), 1500);
      },
      sendVoice: (chatId, recording, options) => {
        if (recording.blob.size === 0) {
          return;
        }
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: new Date(),
          status: 'sending',
          voice: {
            duration_ms: Math.max(1, recording.durationMs),
            mime: 'audio/mp4',
            waveform: recording.waveform.length > 0 ? recording.waveform : [12],
            url: sampleVoiceDataUrl(recording.durationMs),
          },
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: [...(state.messagesByChat[chatId] ?? []), message],
          },
          chats: withLastMessage(state.chats, chatId, message),
        }));
        window.setTimeout(() => setStatus(chatId, message.id, 'sent'), 300);
        window.setTimeout(() => setStatus(chatId, message.id, 'read'), 1500);
      },
      sendAttachment: (chatId, file, options) => {
        if (file.size === 0) {
          return;
        }
        const kind = classify(file);
        const name = cleanFilename(file.name);
        const mime = file.type === '' ? 'application/octet-stream' : file.type;
        const localUrl = kind === 'image' ? objectUrlFor(file) : undefined;
        const caption = options?.caption?.trim() ?? '';
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: new Date(),
          status: 'sending',
          attachment: {
            kind,
            url: localUrl ?? `https://files.zilar.test/${encodeURIComponent(name)}`,
            name,
            size: file.size,
            mime,
          },
          ...(caption.length === 0 ? {} : { text: caption }),
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: [...(state.messagesByChat[chatId] ?? []), message],
          },
          chats: withLastMessage(state.chats, chatId, message),
        }));
        window.setTimeout(() => setStatus(chatId, message.id, 'sent'), 300);
        window.setTimeout(() => setStatus(chatId, message.id, 'read'), 1500);
      },
      sendSticker: (chatId, sticker, options) => {
        const data = {
          pack_id: sticker.packId,
          sticker_id: sticker.stickerId,
          url: sticker.url,
          ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        };
        // Same guard as the real store: tampered recents must refuse loudly,
        // never leave a bubble behind.
        if (!isValid(StickerSchema)(data)) {
          set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
          return;
        }
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: sticker.emoji ?? '',
          createdAt: new Date(),
          status: 'sending',
          card: { v: 0, type: 'sticker', data },
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: [...(state.messagesByChat[chatId] ?? []), message],
          },
          chats: withLastMessage(state.chats, chatId, message),
        }));
        window.setTimeout(() => setStatus(chatId, message.id, 'sent'), 300);
        window.setTimeout(() => setStatus(chatId, message.id, 'read'), 1500);
      },
      forwardMessages: () => {
        // The mock store does not model forwards; the action exists so the
        // picker and other mock UI compile and call it.
      },
      retrySticker: (chatId, messageId) => {
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? []).map((item) => {
              if (item.id !== messageId || item.failed === undefined) {
                return item;
              }
              const next: UiMessage = { ...item };
              delete next.failed;
              return next;
            }),
          },
        }));
      },
      retryAttachment: () => {},
      // Mock mode keeps no bytes: a retry just clears the failure flag and a
      // delete drops the failed bubble, so the failure UI is exercisable.
      retryVoice: (chatId, messageId) => {
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? []).map((item) => {
              if (item.id !== messageId || item.status !== 'failed') {
                return item;
              }
              const next: UiMessage = { ...item, status: 'sending' };
              delete next.failed;
              delete next.failureReason;
              return next;
            }),
          },
        }));
      },
      deleteFailedMessage: (chatId, messageId) => {
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? []).filter(
              (item) => item.id !== messageId || item.status !== 'failed',
            ),
          },
        }));
      },
      setSearch: (value) => set({ search: value }),
      searchChat: undefined,
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
    };
  });
}

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
