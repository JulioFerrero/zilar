import type { MessageStatus, UiMessage } from '@galena/chat-core';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { CURRENT_USER_ID, CURRENT_USER_NAME } from '../lib/types';
import { mockChats, mockMessagesByChat } from '../mock';
import {
  MOCK_DRAFT_CHAT_ID,
  MOCK_DRAFT_FINAL_MESSAGE_ID,
  MOCK_DRAFT_STREAM_TEXT,
  MOCK_DRAFT_TURN_ID,
  createMockDraftFinalMessage,
  readMockDraftPhase,
  type MockDraftPhase,
} from '../mock/drafts';
import type { ChatStoreState } from './types';

/** Simulated send states, from T-0018 step 5. */
export const SENT_DELAY_MS = 300;
export const READ_DELAY_MS = 1500;

/** Mock typing simulation, mirroring the web app (T-0022). */
export const TYPING_START_MS = 2000;
export const TYPING_DURATION_MS = 4000;

const NO_MESSAGES: UiMessage[] = [];

/** The data fields of the store, without the actions. */
type ChatStoreData = Omit<
  ChatStoreState,
  | 'messages'
  | 'openChat'
  | 'loadOlder'
  | 'hasMore'
  | 'sendText'
  | 'sendTyping'
  | 'setSearch'
  | 'setActiveFolder'
  | 'start'
  | 'stop'
>;

function cloneMessages(): Record<string, UiMessage[]> {
  return Object.fromEntries(
    Object.entries(mockMessagesByChat).map(([chatId, messages]) => [
      chatId,
      messages.map((message) => ({ ...message })),
    ]),
  );
}

export function createInitialState(phase?: MockDraftPhase): ChatStoreData {
  const messagesByChat = cloneMessages();
  // The `final` phase appends the completed reply, so the last message is the
  // one that takes over the draft's place (same text position, incoming look).
  if (phase === 'final') {
    messagesByChat[MOCK_DRAFT_CHAT_ID] = [
      ...(messagesByChat[MOCK_DRAFT_CHAT_ID] ?? []),
      createMockDraftFinalMessage(),
    ];
  }
  const chats = mockChats.map((chat) => {
    const lastMessage = messagesByChat[chat.id]?.at(-1);
    return lastMessage ? { ...chat, lastMessage } : { ...chat };
  });
  return {
    currentUserId: CURRENT_USER_ID,
    me: undefined,
    status: 'online',
    chats,
    contacts: [],
    messagesByChat,
    search: '',
    activeFolder: 'all',
    activeChatId: null,
    historyComplete: {},
    typing: {},
    drafts:
      phase === 'stream'
        ? { [MOCK_DRAFT_CHAT_ID]: { turnId: MOCK_DRAFT_TURN_ID, text: MOCK_DRAFT_STREAM_TEXT } }
        : {},
    finishedDraftMessages:
      phase === 'final' ? { [MOCK_DRAFT_FINAL_MESSAGE_ID]: MOCK_DRAFT_TURN_ID } : {},
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

/** The mock store kept for `?mock=1` dev mode and unit tests. */
export function createChatStore(
  phase: MockDraftPhase | undefined = readMockDraftPhase(),
): UseBoundStore<StoreApi<ChatStoreState>> {
  return create<ChatStoreState>()((set, get) => {
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
      ...createInitialState(phase),
      messages: (chatId) => get().messagesByChat[chatId] ?? NO_MESSAGES,
      hasMore: () => false,
      loadOlder: () => {},
      sendTyping: () => {},
      start: () => {},
      stop: () => {},
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

/**
 * `?mock=1` (or `EXPO_PUBLIC_GALENA_MOCK=1`) selects the mock store for local
 * UI work. Vitest also runs on the mock store. The real store is the default.
 */
export function isMockMode(params?: Record<string, string | string[] | undefined>): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_GALENA_MOCK === '1') {
    return true;
  }
  const value = params?.['mock'];
  return value === '1' || (Array.isArray(value) && value.includes('1'));
}
