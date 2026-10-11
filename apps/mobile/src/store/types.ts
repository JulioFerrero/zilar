import type {
  ChatFolder,
  ChatSummary,
  EditsState,
  ReactionsState,
  UiMessage,
} from '@zilar/chat-core';

import type { Contact, Me } from '../lib/chat-api';
import type { PickedFile } from '../lib/attachment-ports';
import type { PutChatPrefInput } from '../lib/chat-prefs-api';
import type { CreateChatFolderInput, PatchChatFolderInput } from '../lib/chat-folders-api';
import type { Pin } from '../lib/pins-api';
import type { MediaPage, MediaTab } from '../lib/media-api';
import type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from './send-types';
import type { DraftState, LoadState } from './list-views';
import type { ChatStoreGroups } from './types-groups';

/**
 * The send option types moved to `send-types.ts` (T-1095); re-exported so
 * importers of this module are unchanged.
 */
export type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from './send-types';

/**
 * The list-view helpers moved to `list-views.ts` (T-1095); re-exported so
 * importers of this module are unchanged.
 */
export type { ChatsListView, DraftState, LoadState, MessagesListView } from './list-views';
export { chatsListView, draftEntryKey, emptyChatsText, messagesListView } from './list-views';

/** The group, channel, topic, invite and role slice moved to `types-groups.ts` (T-1095). */
export type { ChatStoreGroups } from './types-groups';

/** Connection state shown by the thin "Connecting…" bar in the chat list. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type TypingState = {
  names: string[];
};

/**
 * The state and actions the mobile screens use. Both the mock store and the
 * real store implement it, so the components do not care which one is running.
 *
 * The group, channel, topic, invite and role actions live in `ChatStoreGroups`
 * (`types-groups.ts`, T-1095) and this interface extends it.
 */
export interface ChatStoreState extends ChatStoreGroups {
  currentUserId: string;
  me?: Me;
  status: ConnectionStatus;
  /**
   * The first chat-list load (T-0067). `error` keeps any chats already shown,
   * so a failed refresh never blanks a list the user is looking at.
   */
  chatsLoad: LoadState;
  chats: ChatSummary[];
  contacts: Contact[];
  messagesByChat: Record<string, UiMessage[]>;
  /** The first history page of each chat, by chat id (T-0067). */
  historyLoad: Record<string, LoadState>;
  search: string;
  /** 'all' or a folder id; folders arrive from /api/chat-folders (T-0248). */
  activeFolder: string;
  /** Server folders sorted by position; `[]` until synced. */
  folders: ChatFolder[];
  /**
   * Whether the folders have synced at least once (T-0262). The editor uses
   * it to tell "not loaded yet" (a cold start or deep link) from "the folder
   * no longer exists". The mock store starts `true`, the real store flips it
   * on the first successful `setFolders`.
   */
  foldersLoaded: boolean;
  activeChatId: string | null;
  historyComplete: Record<string, boolean>;
  typing: Record<string, TypingState>;
  /**
   * Edit state (XEP-0308 corrections and XEP-0424 retractions) per chat id.
   * The store canonicalises every target through its alias map before calling
   * the reducers, and updates that arrive before their target stays pending.
   */
  edits: Record<string, EditsState>;
  /**
   * Reaction state (XEP-0444) per chat id. The store canonicalises every
   * target through its alias map before applying an update.
   */
  reactions: Record<string, ReactionsState>;
  /**
   * Live AI reply drafts by chat id (the AI's bare JID), from
   * `/api/drafts/stream` (T-0056). Empty when no AI is writing.
   */
  drafts: Record<string, DraftState>;
  /**
   * Message id -> the draft turn it replaced (T-0056). The final message keeps
   * rendering on the draft's key so its reveal continues instead of snapping.
   */
  finishedDraftMessages: Record<string, string>;
  /** The message the composer is currently editing, or undefined when idle. */
  editTarget?: { chatId: string; messageId: string };
  /** A user-facing failure from a recent edit/delete (T-0085). */
  actionError?: { chatId: string; message: string } | undefined;
  /**
   * The hostnames attachment rendering auto-loads from (T-0150, the mobile
   * twin of web's `mediaTrustedHosts`): the XMPP service host, the XMPP
   * domain and `upload.<domain>`, from the latest XMPP token. Undefined
   * until the token arrives; the bubble then trusts nothing.
   */
  mediaTrustedHosts?: ReadonlySet<string>;
  messages: (chatId: string) => UiMessage[];
  hasMore: (chatId: string) => boolean;
  openChat: (chatId: string) => void;
  /**
   * Opens a chat and waits until `messageId` is loaded, paging backwards at
   * most `MESSAGE_JUMP_MAX_PAGES` history pages (T-0138, like web's
   * `openAtMessage`). Returns the message once it is loaded so the screen
   * can scroll to it, or throws `message_not_found` when history runs out.
   */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  /**
   * The message a search hit asked to land on. Set by `openAtMessage` once
   * the message is loaded; the chat screen scrolls to it, then clears it.
   */
  jumpTarget?: { chatId: string; messageId: string };
  /** Clears `jumpTarget` after the chat screen has scrolled to it. */
  clearJumpTarget: () => void;
  loadOlder: (chatId: string) => void;
  /** Refetch the chat list (pull-to-refresh and the list's Retry key). */
  reloadChats: () => void;
  /** Retry the first history page of a chat after it failed. */
  retryHistory: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
  /** Sends a picked file as an attachment payload in the chat (T-0150). */
  sendAttachment: (chatId: string, file: PickedFile, options?: SendAttachmentOptions) => void;
  /** Retries a failed attachment send (the bytes are kept for the retry). */
  retryAttachment: (chatId: string, messageId: string) => void;
  /** Cancels the in-flight upload of an attachment send. */
  cancelAttachment: (chatId: string, messageId: string) => void;
  /** Sends a recorded voice message in the chat (T-0154). */
  sendVoice: (chatId: string, recording: SendVoiceRecording, options?: SendTextOptions) => void;
  /** Retries a failed voice send (the recording is kept for the retry). */
  retryVoice: (chatId: string, messageId: string) => void;
  /** Cancels the in-flight upload of a voice send. */
  cancelVoice: (chatId: string, messageId: string) => void;
  /** Sends a sticker payload in the chat (same path as other payload messages). */
  sendSticker: (chatId: string, sticker: SendStickerChoice, options?: SendTextOptions) => void;
  /** Retries a failed sticker send (the payload is already on the message). */
  retrySticker: (chatId: string, messageId: string) => void;
  /**
   * Forwards copies of `messages` into each target chat (T-0432): one
   * optimistic copy per message per target with a validated forward origin,
   * then the optional `comment` as one text message per target that queued a
   * copy. Deleted, failed and still-sending messages are skipped.
   */
  forwardMessages: (
    targets: string[],
    messages: UiMessage[],
    options?: { comment?: string },
  ) => void;
  /** Toggle my reaction of `emoji` on a message (XEP-0444). */
  react: (chatId: string, messageId: string, emoji: string) => void;
  /** Begin editing `messageId`: composer switches to edit mode with its text. */
  startEdit: (chatId: string, messageId: string) => void;
  /** Cancel the current edit without sending anything. */
  cancelEdit: () => void;
  /** Save the edited text and send a XEP-0308 correction. */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /** Send a XEP-0424 retraction ("delete for everyone"). */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** Dismiss the current `actionError` inline notice. */
  dismissActionError: () => void;
  /**
   * Sets a per-user pref on one chat (mute/archive/pin), optimistic with a
   * re-fetch of the row on success and a state restore on failure. Rejects
   * on failure. For topics the caller passes the row chat id (a topic room
   * JID); group mute = a pref on the General row, inherited by its topics.
   */
  setChatPref: (chatId: string, input: PutChatPrefInput) => Promise<void>;
  /**
   * Pins of one chat, newest first. Loaded when the chat opens (and on
   * focus), refreshed while it is open, optimistic on pin/unpin.
   */
  pins: (chatId: string) => Pin[];
  /** A user-facing pins failure for one chat (load/pin/unpin). */
  pinsError?: { chatId: string; message: string };
  /** Loads the pins of one chat (called on open; silent while open). */
  refreshPins: (chatId: string) => Promise<void>;
  /** The pin for a loaded message, if it is pinned. */
  pinFor: (chatId: string, messageId: string) => Pin | undefined;
  /**
   * Whether the viewer may pin in a chat: either side of a DM, a group
   * owner/admin for topics (the manager rule, minus the topic-creator edge
   * the client cannot see — the server still enforces it).
   */
  canPin: (chatId: string) => boolean;
  /** Pins a loaded message with its display-only snapshot. Rejects on failure. */
  pinMessage: (chatId: string, messageId: string) => Promise<void>;
  /** Unpins by pin id, echoing the removed row. Rejects on failure. */
  unpinMessage: (chatId: string, pinId: string) => Promise<void>;
  /** Dismisses the current `pinsError` inline notice. */
  dismissPinsError: () => void;
  /**
   * Stops the open chat's pins poll (leaving the chat). The store also
   * stops it when another chat opens, the app goes idle, or it stops.
   */
  stopPinsPoll: () => void;
  /**
   * One page of a chat's media gallery (T-0436): the items of `tab`, newest
   * first, plus the paging cursor. The mock store builds it from its own
   * messages; the real store reads `GET /api/media` and resolves relative
   * URLs. Image and gif rows come back without a `url` when the host is not
   * trusted, so the sheet renders them as file rows.
   */
  loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: string) => void;
  setFolders: (folders: ChatFolder[]) => void;
  /** Creates a folder and merges the server's row. Rejects on failure. */
  createFolder: (input: CreateChatFolderInput) => Promise<ChatFolder>;
  /** Patches a folder and replaces it with the server's row. Rejects on failure. */
  updateFolder: (id: string, input: PatchChatFolderInput) => Promise<ChatFolder>;
  /** Deletes a folder and drops it from the list. Rejects on failure. */
  deleteFolder: (id: string) => Promise<void>;
  /** Saves a new order and takes the server's returned list. Rejects on failure. */
  reorderFolders: (ids: string[]) => Promise<void>;
  start: () => void;
  stop: () => void;
}
