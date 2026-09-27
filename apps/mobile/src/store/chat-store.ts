import type { ChatSummary, MessageStatus, ReplyRef, UiMessage } from '@galena/chat-core';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { CURRENT_USER_ID, CURRENT_USER_NAME, type ChatFolder } from '../lib/types';
import { mockChats, mockMessagesByChat } from '../mock';

/** Simulated send states, from T-0018 step 5. */
export const SENT_DELAY_MS = 300;
export const READ_DELAY_MS = 1500;

/** Mock typing simulation, mirroring the web app (T-0022). */
export const TYPING_START_MS = 2000;
export const TYPING_DURATION_MS = 4000;

export type TypingState = {
  names: string[];
};

export type SendTextOptions = {
  replyTo?: ReplyRef;
};

const NO_MESSAGES: UiMessage[] = [];

export type ChatStore = {
  currentUserId: string;
  chats: ChatSummary[];
  messagesByChat: Record<string, UiMessage[]>;
  search: string;
  activeFolder: ChatFolder;
  activeChatId: string | null;
  typing: Record<string, TypingState>;
  messages: (chatId: string) => UiMessage[];
  openChat: (chatId: string) => void;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  setSearch: (search: string) => void;
  setActiveFolder: (folder: ChatFolder) => void;
};

type ChatStoreState = Omit<
  ChatStore,
  'messages' | 'openChat' | 'sendText' | 'setSearch' | 'setActiveFolder'
>;

function cloneMessages(): Record<string, UiMessage[]> {
  return Object.fromEntries(
    Object.entries(mockMessagesByChat).map(([chatId, messages]) => [
      chatId,
      messages.map((message) => ({ ...message })),
    ]),
  );
}

export function createInitialState(): ChatStoreState {
  const messagesByChat = cloneMessages();
  const chats = mockChats.map((chat) => {
    const lastMessage = messagesByChat[chat.id]?.at(-1);
    return lastMessage ? { ...chat, lastMessage } : { ...chat };
  });
  return {
    currentUserId: CURRENT_USER_ID,
    chats,
    messagesByChat,
    search: '',
    activeFolder: 'all',
    activeChatId: null,
    typing: {},
  };
}

/**
 * Mock typing: Ana and "Viernes 🍻" start typing `TYPING_START_MS` after the
 * store is created and stop `TYPING_DURATION_MS` later, like the web app.
 */
function scheduleTypingSimulation(set: (partial: Partial<ChatStoreState>) => void): void {
  setTimeout(() => {
    set({ typing: { ana: { names: ['Ana'] }, viernes: { names: ['Luis'] } } });
  }, TYPING_START_MS);
  setTimeout(() => {
    set({ typing: {} });
  }, TYPING_START_MS + TYPING_DURATION_MS);
}

let messageCounter = 0;

export function createChatStore(): UseBoundStore<StoreApi<ChatStore>> {
  return create<ChatStore>()((set, get) => {
    const setStatus = (chatId: string, messageId: string, status: MessageStatus) => {
      set((state) => {
        const messages = state.messagesByChat[chatId];
        if (!messages?.some((message) => message.id === messageId && message.status !== status)) {
          return state;
        }
        return {
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: messages.map((message) =>
              message.id === messageId ? { ...message, status } : message,
            ),
          },
          chats: state.chats.map((chat) => {
            const last = chat.lastMessage;
            return chat.id === chatId && last?.id === messageId
              ? { ...chat, lastMessage: { ...last, status } }
              : chat;
          }),
        };
      });
    };

    scheduleTypingSimulation(set);

    return {
      ...createInitialState(),
      messages: (chatId) => get().messagesByChat[chatId] ?? NO_MESSAGES,
      openChat: (chatId) => {
        set((state) => ({
          activeChatId: chatId,
          chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
        }));
      },
      sendText: (chatId, text, options) => {
        const trimmed = text.trim();
        if (!trimmed || !get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        messageCounter += 1;
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: get().currentUserId,
          senderName: CURRENT_USER_NAME,
          text: trimmed,
          createdAt: new Date(),
          status: 'sending',
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: [...(state.messagesByChat[chatId] ?? NO_MESSAGES), message],
          },
          chats: state.chats.map((chat) =>
            chat.id === chatId ? { ...chat, lastMessage: message } : chat,
          ),
        }));
        setTimeout(() => setStatus(chatId, message.id, 'sent'), SENT_DELAY_MS);
        setTimeout(() => setStatus(chatId, message.id, 'read'), READ_DELAY_MS);
      },
      setSearch: (search) => set({ search }),
      setActiveFolder: (activeFolder) => set({ activeFolder }),
    };
  });
}

export const useChatStore = createChatStore();
