import {
  type ChatSummary,
  type EditsState,
  type ReactionsState,
  type UiMessage,
  type ChatFolder,
  MUTE_DURATIONS,
  applyChatPrefs,
  effectivePrefFor,
  mutedUntilFor,
  sortPinnedFirst,
  type MuteDurationId,
} from '@zilar/chat-core';
import type {
  ChatBackgroundChoice,
  ChatPref,
  Contact,
  GroupDetail,
  Me,
  MediaPage,
  MediaTab,
  Pin,
} from '@/lib/api';
import type { ChatStoreGroupApi } from './groupStoreTypes';
import type {
  ChatsState,
  ConnectionStatus,
  DraftState,
  HistoryState,
  SendAttachmentOptions,
  SendStickerInput,
  SendTextOptions,
  TypingState,
  VoiceRecording,
} from './storeOptions';

export interface ChatStore extends ChatStoreGroupApi {
  currentUserId: string;
  me: Me | undefined;
  status: ConnectionStatus;
  /** Loading state of the chat list itself. ready after the first merge. */
  chatsState: ChatsState;
  /** Per-chat loading state of the first history page. Absent means ready. */
  historyState: Record<string, HistoryState>;
  /** Effective first-page state for one chat: loading when the page was never requested,
   *  ready otherwise (the mock store reports ready unless seeded). */
  historyStateFor: (chatId: string) => HistoryState;
  retryChats: () => void;
  refreshGeneralTopic: (groupId: string) => Promise<string | undefined>;
  retryHistory: (chatId: string) => void;
  chats: ChatSummary[];
  contacts: Contact[];
  messages: (chatId: string) => UiMessage[];
  /** Server chat-preference rows by lowercased chat JID. Loaded with the chat list;
   *  mute/archive/pin patch one row optimistically and roll back on failure. */
  chatPrefs: Record<string, ChatPref>;
  refreshChatPrefs: () => Promise<void>;
  /** The caller's global background default; null until loaded. */
  defaultBackground: ChatBackgroundChoice | null;
  /** Loads the caller's global background default. Never rejects. */
  refreshDefaultBackground: () => Promise<void>;
  /** Pins or unpins a chat/topic. Optimistic with rollback. Rejects on failure. */
  setPinned: (chatId: string, pinned: boolean) => Promise<void>;
  /** Mutes a chat/topic for a duration, or unmutes. Optimistic with rollback. */
  setMuted: (chatId: string, duration: MuteDurationId | null) => Promise<void>;
  /** Archives or unarchives a chat/topic. Optimistic with rollback. */
  setArchived: (chatId: string, archived: boolean) => Promise<void>;
  /** Sets or clears the unread mark, and marks a chat read (count, server mark and pref). */
  setUnreadMark: (chatId: string, unreadMark: boolean) => Promise<void>;
  markChatRead: (chatId: string) => Promise<void>;
  setChatBackground: (chatId: string, presetId: string | null) => Promise<void>;
  setDefaultBackground: (presetId: string | null) => Promise<void>;
  setChatBackgroundImage: (chatId: string, imageId: string, dim: number) => Promise<void>;
  setDefaultBackgroundImage: (imageId: string, dim: number) => Promise<void>;
  /** Pins of a chat, newest first; empty until loadPins resolves. */
  pins: (chatId: string) => Pin[];
  /** Whether the pins of a chat were ever loaded (mock store: always true). */
  pinsLoaded: (chatId: string) => boolean;
  /** Loads the pins of a chat from the server. Never rejects. */
  loadPins: (chatId: string) => Promise<void>;
  /** Loads one page of a chat's media gallery: before is the previous page's next cursor.
   *  Image items on an untrusted host come back without a url (a file row instead). */
  loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>;
  /** Whether the caller may pin in a chat: DMs either side, topics a manager. */
  canPin: (chatId: string) => boolean;
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /** Pins a message (snapshot from the loaded message). Optimistic with rollback. */
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  /** Removes a pin. Optimistic with rollback. Rejects on failure. */
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  pinsPanel: { chatId: string } | undefined;
  setPinsPanel: (chatId: string | undefined) => void;
  /** The inline error of the last pin or unpin that failed. */
  pinsError: { chatId: string; message: string } | undefined;
  dismissPinsError: () => void;
  archivedChats: () => ChatSummary[];
  typing: Record<string, TypingState>;
  /** Live AI reply drafts by chat id (the AI's bare JID), from /api/drafts/stream. */
  drafts: Record<string, DraftState>;
  /** Message id -> the draft turn it replaced. The final message keeps rendering on the
   *  draft's key, so its reveal continues instead of snapping. */
  finishedDraftMessages: Record<string, string>;
  openChat: (chatId: string) => void;
  /** Clears activeChatId when the leaving chat is still the open one, so a message arriving
   *  while the list is on screen counts as unread. */
  closeChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  hasMore: (chatId: string) => boolean;
  /** Opens a chat at one message: loads history until it is present. Rejects with
   *  message_not_found when history runs out first. */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendVoice: (chatId: string, recording: VoiceRecording, options?: SendTextOptions) => void;
  sendAttachment: (chatId: string, file: File, options?: SendAttachmentOptions) => void;
  sendSticker: (chatId: string, sticker: SendStickerInput, options?: SendTextOptions) => void;
  /** Forwards messages to each target chat: one copy per message per target, carrying a
   *  <forward> origin. An optional comment is a separate text message per target. */
  forwardMessages: (
    targets: string[],
    messages: UiMessage[],
    options?: { comment?: string },
  ) => void;
  retrySticker: (chatId: string, messageId: string) => void;
  retryAttachment: (chatId: string, messageId: string) => void;
  retryVoice: (chatId: string, messageId: string) => void;
  /** Removes a failed local bubble; the send never reached the server. */
  deleteFailedMessage: (chatId: string, messageId: string) => void;
  /** Toggles my reaction and sends my complete set (XEP-0444). Optimistic, reverted on failure. */
  react: (chatId: string, messageId: string, emoji: string) => void;
  /** The message currently being edited: the composer shows an edit bar for it. */
  editTarget: { chatId: string; messageId: string } | undefined;
  startEdit: (chatId: string, messageId: string) => void;
  cancelEdit: () => void;
  /** Saves an edit (XEP-0308) optimistically, reverted when the send fails; unchanged text sends nothing. */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /** Deletes a message for everyone (XEP-0424). Optimistic, reverted on a send error. */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** Deletes one message for me, or clears a DM's history for me. */
  deleteForMe: (chatId: string, messageId: string) => void;
  clearHistory: (chatId: string) => Promise<'deleted' | 'unavailable' | 'failed'>;
  /** The inline error of the last edit or delete that failed to send. */
  actionError: { chatId: string; message: string } | undefined;
  /** Enables or disables the push pair over the XMPP session (XEP-0357); rejects offline. */
  setPushPair: (input: { pushJid: string; node: string; enable: boolean }) => Promise<void>;
  /** Hostnames attachment media may auto-load from: the XMPP service host, the XMPP domain
   *  and upload.<domain>. Unknown hosts are treated as untrusted. */
  mediaTrustedHosts: ReadonlySet<string> | undefined;
  sendTyping: (chatId: string) => void;
  stopTyping: (chatId: string) => void;
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
  /** Clears the previous account's state when a different user signs in on the same store:
   *  the chat list and the per-message caches must not carry over. */
  switchUser: () => Promise<void>;
  start: () => void;
  stop: () => void;
  search: string;
  setSearch: (value: string) => void;
  searchChat: string | undefined;
  setSearchChat: (chatId: string | undefined) => void;
  /** 'all' or a folder id; folders arrive from /api/chat-folders. */
  activeFolder: string;
  setActiveFolder: (folder: string) => void;
  /** Folders from the server, sorted by position; [] until synced. */
  folders: ChatFolder[];
  setFolders: (folders: ChatFolder[]) => void;
}

export type ChatStoreState = ChatStore & {
  messagesByChat: Record<string, UiMessage[]>;
  /** Pinned messages by chat id, newest first; the mock store keeps them in memory. */
  pinsByChat: Record<string, Pin[]>;
  /** Chat ids whose pins were ever loaded (real store only). */
  pinsReady: Record<string, boolean>;
  /** XEP-0444 reaction updates by chat id, keyed by the alias-resolved target message id;
   *  kept even for targets that are not loaded yet. */
  reactions: Record<string, ReactionsState>;
  /** XEP-0308/0424 edit state by chat id, keyed by the alias-resolved target message id.
   *  The mock store keeps the flags on the messages instead and leaves this empty. */
  edits: Record<string, EditsState>;
  activeChatId: string | undefined;
  historyComplete: Record<string, boolean>;
  groupInfos: Record<string, GroupDetail>;
};

export type {
  ChatsState,
  ConnectionStatus,
  DraftState,
  HistoryState,
  SendAttachmentOptions,
  SendStickerInput,
  SendTextOptions,
  TypingState,
  VoiceRecording,
} from './storeOptions';
export { matchesFolder, visibleChats } from './selectors';
export { groupChats, folderUnread } from './chatGroups';
export type { ChatGroup } from './chatGroups';
export { MUTE_DURATIONS, applyChatPrefs, effectivePrefFor, mutedUntilFor, sortPinnedFirst };
export type { MuteDurationId };
export type { ChatStoreGroupApi } from './groupStoreTypes';
