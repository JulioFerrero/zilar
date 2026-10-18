import type {
  ChatFolder,
  ChatSummary,
  EditsState,
  ReactionsState,
  UiMessage,
} from '@zilar/chat-core';
import type { DeleteOutcome } from '@zilar/client-core/store';

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

export type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from './send-types';

export type { ChatsListView, DraftState, LoadState, MessagesListView } from './list-views';
export { chatsListView, draftEntryKey, emptyChatsText, messagesListView } from './list-views';

export type { ChatStoreGroups } from './types-groups';

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
