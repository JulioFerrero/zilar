import type { ChatSummary, EditsState, ReactionsState, UiMessage } from '@zilar/chat-core';
import type { ChatFolder } from '@zilar/chat-core';
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
import {
  MUTE_DURATIONS,
  applyChatPrefs,
  effectivePrefFor,
  mutedUntilFor,
  sortPinnedFirst,
} from '@/lib/chatPrefs';
import type { MuteDurationId } from '@/lib/chatPrefs';
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
  /** T-1244: sets or clears the unread mark, and marks a chat read (count, server mark and pref). */
  setUnreadMark: (chatId: string, unreadMark: boolean) => Promise<void>;
  markChatRead: (chatId: string) => Promise<void>;
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
  /**
   * Clears `activeChatId` when the leaving chat is still the open one, so a
   * message arriving while the list is on screen counts as unread (T-1147).
   */
  closeChat: (chatId: string) => void;
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
  /** Deletes a message for everyone (XEP-0424). Optimistic, reverted on a send error. */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** T-1247: delete one message for me, or clear a DM's history for me. */
  deleteForMe: (chatId: string, messageId: string) => void;
  clearHistory: (chatId: string) => Promise<'deleted' | 'unavailable' | 'failed'>;
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
  /**
   * Clears the previous account's state when a different user signs in on the
   * same store (T-1136): the chat list and the per-message caches must not
   * carry over. Unlike `signOut`, the session and the route stay put.
   */
  switchUser: () => Promise<void>;
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
