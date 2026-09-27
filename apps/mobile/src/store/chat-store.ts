import { create, type StoreApi, type UseBoundStore } from 'zustand';

import {
  CURRENT_USER_ID,
  CURRENT_USER_NAME,
  type ChatFolder,
  type ChatSummary,
  type MessageStatus,
  type UiMessage,
} from '../lib/types';
import { mockChats, mockMessagesByChat } from '../mock';

/** Simulated send states, from T-0018 step 5. */
export const SENT_DELAY_MS = 300;
export const READ_DELAY_MS = 1500;

const NO_MESSAGES: UiMessage[] = [];

export type ChatStore = {
  chats: ChatSummary[];
  messagesByChat: Record<string, UiMessage[]>;
  search: string;
  activeFolder: ChatFolder;
  activeChatId: string | null;
  messages: (chatId: string) => UiMessage[];
  openChat: (chatId: string) => void;
  sendText: (chatId: string, text: string) => void;
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
    chats,
    messagesByChat,
    search: '',
    activeFolder: 'all',
    activeChatId: null,
  };
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

    return {
      ...createInitialState(),
      messages: (chatId) => get().messagesByChat[chatId] ?? NO_MESSAGES,
      openChat: (chatId) => {
        set((state) => ({
          activeChatId: chatId,
          chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
        }));
      },
      sendText: (chatId, text) => {
        const trimmed = text.trim();
        if (!trimmed || !get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        messageCounter += 1;
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: CURRENT_USER_ID,
          senderName: CURRENT_USER_NAME,
          text: trimmed,
          createdAt: new Date().toISOString(),
          status: 'sending',
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
