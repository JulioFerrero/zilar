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
