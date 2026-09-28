import type { ChatSummary, MessageStatus, ReplyRef, UiMessage } from '@galena/chat-core';
import type { Contact, Me } from '@/lib/api';
import { sampleVoiceDataUrl } from '@/lib/voice';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import { currentUserId as defaultCurrentUserId, mockChats, mockMessages } from '@/mock';

export type FolderId = 'all' | 'personal' | 'ais' | 'work';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface TypingState {
  names: string[];
}

export interface SendTextOptions {
  replyTo?: ReplyRef;
}

/** A finished recording on its way to the server and then to XEP-0363. */
export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  waveform: number[];
}

export interface ChatStore {
  currentUserId: string;
  me: Me | undefined;
  status: ConnectionStatus;
  chats: ChatSummary[];
  contacts: Contact[];
  messages: (chatId: string) => UiMessage[];
  typing: Record<string, TypingState>;
  openChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  hasMore: (chatId: string) => boolean;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendVoice: (chatId: string, recording: VoiceRecording, options?: SendTextOptions) => void;
  sendTyping: (chatId: string) => void;
  createGroup: (title: string, memberIds: string[]) => Promise<string>;
  createInvite: () => Promise<string>;
  signOut: () => Promise<void>;
  start: () => void;
  stop: () => void;
  search: string;
  setSearch: (value: string) => void;
  activeFolder: FolderId;
  setActiveFolder: (folder: FolderId) => void;
}

export type ChatStoreState = ChatStore & {
  messagesByChat: Record<string, UiMessage[]>;
  activeChatId: string | undefined;
  historyComplete: Record<string, boolean>;
};

export interface ChatStoreSeed {
  currentUserId?: string;
  me?: Me;
  status?: ConnectionStatus;
  contacts?: Contact[];
  chats?: ChatSummary[];
  messagesByChat?: Record<string, UiMessage[]>;
}

function cloneMessages(source: Record<string, UiMessage[]>): Record<string, UiMessage[]> {
  return Object.fromEntries(
    Object.entries(source).map(([chatId, messages]) => [chatId, messages.map(withPlayableVoice)]),
  );
}

// The mock data has no real audio. Give every voice message a synthesized tone
// so the player in the bubble is genuinely usable during UI work and screenshots.
function withPlayableVoice(message: UiMessage): UiMessage {
  if (message.voice === undefined || message.voice.url !== undefined) {
    return message;
  }
  return {
    ...message,
    voice: { ...message.voice, url: sampleVoiceDataUrl(message.voice.duration_ms) },
  };
}

function withLastMessage(chats: ChatSummary[], chatId: string, message: UiMessage): ChatSummary[] {
  return chats.map((chat) =>
    chat.id === chatId ? { ...chat, lastMessage: message, unread: 0 } : chat,
  );
}

const TYPING_START_MS = 2000;
const TYPING_DURATION_MS = 4000;

/**
 * Mock typing simulation: Ana and the "Viernes 🍻" group start typing two
 * seconds after the app loads and stop four seconds later.
 */
function scheduleTypingSimulation(set: (partial: Partial<ChatStoreState>) => void): void {
  window.setTimeout(() => {
    set({
      typing: {
        'c-ana': { names: ['Ana'] },
        'c-viernes': { names: ['Luis'] },
      },
    });
  }, TYPING_START_MS);
  window.setTimeout(() => {
    set({ typing: {} });
  }, TYPING_START_MS + TYPING_DURATION_MS);
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

    scheduleTypingSimulation(set);

    return {
      currentUserId: seed.currentUserId ?? defaultCurrentUserId,
      me:
        seed.me ??
        ({
          id: seed.currentUserId ?? defaultCurrentUserId,
          email: 'you@galena.test',
          name: 'You',
          image: null,
          jid: null,
        } satisfies Me),
      status: seed.status ?? 'online',
      contacts: seed.contacts ?? [],
      chats: seed.chats ?? mockChats,
      messagesByChat: cloneMessages(seed.messagesByChat ?? mockMessages),
      activeChatId: undefined,
      historyComplete: {},
      search: '',
      activeFolder: 'all',
      typing: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      openChat: (chatId) =>
        set((state) => ({
          activeChatId: chatId,
          chats: state.chats.map((chat) =>
            chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
          ),
        })),
      loadOlder: () => {},
      hasMore: () => false,
      sendTyping: () => {},
      createGroup: async () => {
        throw new Error('createGroup is not available in the mock store');
      },
      createInvite: async () => {
        throw new Error('createInvite is not available in the mock store');
      },
      signOut: async () => {},
      start: () => {},
      stop: () => {},
      sendText: (chatId, text, options) => {
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
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
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
      sendVoice: (chatId, recording, options) => {
        if (recording.blob.size === 0) {
          return;
        }
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: new Date(),
          status: 'sending',
          voice: {
            duration_ms: Math.max(1, recording.durationMs),
            mime: 'audio/mp4',
            waveform: recording.waveform.length > 0 ? recording.waveform : [12],
            url: sampleVoiceDataUrl(recording.durationMs),
          },
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
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
