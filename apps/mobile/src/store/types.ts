import type { ChatSummary, ReplyRef, UiMessage } from '@galena/chat-core';

import type { Contact, Me } from '../lib/chat-api';
import type { ChatFolder } from '../lib/types';

/** Connection state shown by the thin "Connecting…" bar in the chat list. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type TypingState = {
  names: string[];
};

export type SendTextOptions = {
  replyTo?: ReplyRef;
};

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

/**
 * The state and actions the mobile screens use. Both the mock store and the
 * real store implement it, so the components do not care which one is running.
 */
export interface ChatStoreState {
  currentUserId: string;
  me?: Me;
  status: ConnectionStatus;
  chats: ChatSummary[];
  contacts: Contact[];
  messagesByChat: Record<string, UiMessage[]>;
  search: string;
  activeFolder: ChatFolder;
  activeChatId: string | null;
  historyComplete: Record<string, boolean>;
  typing: Record<string, TypingState>;
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
  messages: (chatId: string) => UiMessage[];
  hasMore: (chatId: string) => boolean;
  openChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: ChatFolder) => void;
  start: () => void;
  stop: () => void;
}
