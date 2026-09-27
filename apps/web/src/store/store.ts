import type { ChatSummary, MessageStatus, UiMessage } from '@galena/chat-core';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import { currentUserId as defaultCurrentUserId, mockChats, mockMessages } from '@/mock';

export type FolderId = 'all' | 'personal' | 'ais' | 'work';

export interface ChatStore {
  currentUserId: string;
  chats: ChatSummary[];
  messages: (chatId: string) => UiMessage[];
  openChat: (chatId: string) => void;
  sendText: (chatId: string, text: string) => void;
  search: string;
  setSearch: (value: string) => void;
  activeFolder: FolderId;
  setActiveFolder: (folder: FolderId) => void;
}

export type ChatStoreState = ChatStore & {
  messagesByChat: Record<string, UiMessage[]>;
};

export interface ChatStoreSeed {
  currentUserId?: string;
  chats?: ChatSummary[];
  messagesByChat?: Record<string, UiMessage[]>;
}

function cloneMessages(source: Record<string, UiMessage[]>): Record<string, UiMessage[]> {
  return Object.fromEntries(
    Object.entries(source).map(([chatId, messages]) => [chatId, [...messages]]),
  );
}

function withLastMessage(chats: ChatSummary[], chatId: string, message: UiMessage): ChatSummary[] {
  return chats.map((chat) =>
    chat.id === chatId ? { ...chat, lastMessage: message, unread: 0 } : chat,
  );
}

export function createChatStore(seed: ChatStoreSeed = {}): StoreApi<ChatStoreState> {
  let sequence = 0;

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

    return {
      currentUserId: seed.currentUserId ?? defaultCurrentUserId,
      chats: seed.chats ?? mockChats,
      messagesByChat: cloneMessages(seed.messagesByChat ?? mockMessages),
      search: '',
      activeFolder: 'all',
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      openChat: (chatId) =>
        set((state) => ({
          chats: state.chats.map((chat) =>
            chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
          ),
        })),
      sendText: (chatId, text) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          return;
        }
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: trimmed,
          createdAt: new Date(),
          status: 'sending',
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
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
    };
  });
}

export function matchesFolder(chat: ChatSummary, folder: FolderId): boolean {
  switch (folder) {
    case 'all':
      return true;
    case 'personal':
      return chat.space === 'personal' && chat.kind !== 'ai';
    case 'ais':
      return chat.kind === 'ai';
    case 'work':
      return chat.space === 'work' && chat.kind !== 'ai';
  }
}

export function visibleChats(state: ChatStoreState): ChatSummary[] {
  const query = state.search.trim().toLowerCase();
  return state.chats.filter((chat) => {
    if (!matchesFolder(chat, state.activeFolder)) {
      return false;
    }
    return query.length === 0 || chat.title.toLowerCase().includes(query);
  });
}

export function folderUnread(state: ChatStoreState, folder: FolderId): number {
  return state.chats
    .filter((chat) => matchesFolder(chat, folder))
    .reduce((total, chat) => total + chat.unread, 0);
}
