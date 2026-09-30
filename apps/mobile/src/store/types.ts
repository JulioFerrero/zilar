import type {
  ChatSummary,
  EditsState,
  ReactionsState,
  ReplyRef,
  UiMessage,
} from '@galena/chat-core';

import type { Contact, GroupDetail, Me } from '../lib/chat-api';
import type { CreateTopicInput, PatchTopicInput } from '../lib/topics-api';
import type { ChatFolder } from '../lib/types';

/** Connection state shown by the thin "Connecting…" bar in the chat list. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type TypingState = {
  names: string[];
};

export type SendTextOptions = {
  replyTo?: ReplyRef;
};

/**
 * A quiet load state (T-0067): `loading` until the data has actually arrived,
 * `error` when it failed, `loaded` once it is known. "empty" is not a load
 * state; it is what a finished load with no rows looks like.
 */
export type LoadState = 'loading' | 'loaded' | 'error';

/** The live AI draft of one chat: the latest cumulative reply text. */
export type DraftState = {
  turnId: string;
  text: string;
};

/**
 * The list key of a message (T-0056). A message that finished a draft keeps the
 * draft's `draft-<turnId>` key, so the bubble component is reused and its reveal
 * carries over instead of snapping in as a new message.
 */
export function draftEntryKey(
  messageId: string,
  finishedDraftMessages: Record<string, string>,
): string {
  const turnId = finishedDraftMessages[messageId];
  return turnId === undefined ? messageId : `draft-${turnId}`;
}

/** What the chat list shows for its current load state and row count. */
export type ChatsListView = 'skeleton' | 'error' | 'empty' | 'list';

/**
 * The chat list's view state (T-0067): a load that has never shown rows gets
 * the skeleton, a failure with no rows the centered Retry, and the empty text
 * only once a load has settled. Rows already shown keep the list.
 */
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

/** What the chat screen shows for its current load state and message count. */
export type MessagesListView = 'skeleton' | 'error' | 'empty' | 'messages';

/** The message list's view state (T-0067); live messages override loading. */
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

/**
 * The empty-list text. A filtered or searched list that matched nothing says
 * "No chats found"; a list with no chats at all says "No chats yet" (T-0067).
 */
export function emptyChatsText(chatCount: number): string {
  return chatCount === 0 ? 'No chats yet' : 'No chats found';
}

/**
 * The state and actions the mobile screens use. Both the mock store and the
 * real store implement it, so the components do not care which one is running.
 */
export interface ChatStoreState {
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
  activeFolder: ChatFolder;
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
  actionError?: { chatId: string; message: string };
  messages: (chatId: string) => UiMessage[];
  hasMore: (chatId: string) => boolean;
  openChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  /** Refetch the chat list (pull-to-refresh and the list's Retry key). */
  reloadChats: () => void;
  /** Retry the first history page of a chat after it failed. */
  retryHistory: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
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
   * The short notice shown when the open topic disappeared (made private,
   * archived, or I was removed) and the view moved to the topics screen.
   * Private topic names never appear here: the text is fixed.
   */
  topicNotice: { groupId: string; message: string } | undefined;
  /** Dismisses the topic notice (or clears a stale one for another group). */
  dismissTopicNotice: () => void;
  /**
   * Bumped every time a group detail finishes loading, so `groupDetail`
   * selectors re-fire for screens mounted before the fetch resolved.
   */
  groupDetailsRevision: number;
  /**
   * The group detail (people + roles + AIs) of one group, keyed by **group
   * id** (not chat id): the topics screen passes its route param straight
   * through. `undefined` until `refreshGroupDetail` has loaded it.
   */
  groupDetail: (groupId: string) => GroupDetail | undefined;
  /** Loads the group detail of one group id (people + roles + AIs). */
  refreshGroupDetail: (groupId: string) => void;
  /** The AIs the viewer owns, for the new-topic sheet's unticked list. */
  ownedAis: { id: string; name: string }[];
  /** Mutes or unmutes one chat (per-chat flag, like the web store). */
  muteChat: (chatId: string, muted: boolean) => void;
  /**
   * Creates a topic in the group that owns `chatId` and opens it. Rejects on
   * failure. Returns the new topic's chat id (its room JID).
   */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /**
   * Patches the topic that owns `chatId` (status, owner, link, visibility,
   * archive), updating the row. Rejects on failure.
   */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
  /** Archives the topic that owns `chatId`. Rejects on failure. */
  archiveTopic: (chatId: string) => Promise<void>;
  /** Adds an AI to the topic and refreshes the row. Rejects on failure. */
  addTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the topic and refreshes the row. Rejects on failure. */
  removeTopicAi: (chatId: string, aiId: string) => Promise<void>;
  /** Adds a person to a private topic and refreshes the row. Rejects on failure. */
  addTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Removes a person from a private topic. Rejects on failure. */
  removeTopicMember: (chatId: string, userId: string) => Promise<void>;
  /** Leaves a private topic. Rejects on failure. */
  leaveTopic: (chatId: string) => Promise<void>;
  /** Reads the members of a private topic (public topics read the group). */
  listTopicMembers: (chatId: string) => Promise<{ userId: string; name: string }[]>;
  /** Reads the AIs in a topic. */
  listTopicAis: (chatId: string) => Promise<{ id: string; name: string }[]>;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: ChatFolder) => void;
  start: () => void;
  stop: () => void;
}
