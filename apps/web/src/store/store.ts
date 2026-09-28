import type {
  ChatSummary,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
} from '@galena/chat-core';
import { mentionsForTrimmedText } from '@galena/chat-core';
import type { Contact, GroupDetail, Me, PublicAi } from '@/lib/api';
import { sampleVoiceDataUrl } from '@/lib/voice';
import type { StoreApi } from 'zustand/vanilla';
import { createStore } from 'zustand/vanilla';
import {
  currentUserId as defaultCurrentUserId,
  mockChats,
  mockGroupDetails,
  mockGroupMembers,
  mockMessages,
  mockOwnedAis,
} from '@/mock';

export type FolderId = 'all' | 'personal' | 'ais' | 'work';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

/** Whether the chat list has arrived: `loading` until the first
 * successful `/api/chats` merge, `error` when that first load fails. */
export type ChatsState = 'loading' | 'ready' | 'error';

/** Whether a chat's first history page has arrived. */
export type HistoryState = 'loading' | 'ready' | 'error';

export interface TypingState {
  names: string[];
}

/** The live AI draft of one chat: the latest cumulative reply text. */
export interface DraftState {
  turnId: string;
  text: string;
}

export interface SendTextOptions {
  replyTo?: ReplyRef;
  mentions?: UiMention[];
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
  /** Loading state of the chat list itself. `ready` after the first merge. */
  chatsState: ChatsState;
  /** Per-chat loading state of the first history page. Absent means `ready`. */
  historyState: Record<string, HistoryState>;
  /**
   * Effective first-page state for one chat. The real store reports
   * `loading` when the page was never requested (e.g. first paint before
   * `openChat` runs); the mock store reports `ready` unless seeded otherwise.
   */
  historyStateFor: (chatId: string) => HistoryState;
  /** Re-runs the first chat-list load after a failure. */
  retryChats: () => void;
  /** Re-runs the first history-page load for one chat after a failure. */
  retryHistory: (chatId: string) => void;
  chats: ChatSummary[];
  contacts: Contact[];
  messages: (chatId: string) => UiMessage[];
  /** Members of a group chat, loaded from the server on open; empty for DMs. */
  groupMembers: (chatId: string) => MentionMember[];
  /** A group's people and AIs, for the info panel; undefined until loaded. */
  groupInfo: (chatId: string) => GroupDetail | undefined;
  /** Reloads a group's people and AIs (the info panel refreshes when it opens). */
  refreshGroupInfo: (chatId: string) => void;
  /** Adds one of my AIs to the group and refreshes. Rejects on failure. */
  addGroupAi: (chatId: string, aiId: string) => Promise<void>;
  /** Removes an AI from the group and refreshes. Rejects on failure. */
  removeGroupAi: (chatId: string, aiId: string) => Promise<void>;
  /** The AIs I own, for the group panel's add picker. */
  listMyAis: () => Promise<PublicAi[]>;
  typing: Record<string, TypingState>;
  /**
   * Live AI reply drafts by chat id (the AI's bare JID), from
   * `/api/drafts/stream` (T-0043). Empty when no AI is writing.
   */
  drafts: Record<string, DraftState>;
  /**
   * Message id -> the draft turn it replaced (T-0045). The final message keeps
   * rendering on the draft's key so its reveal continues instead of snapping.
   */
  finishedDraftMessages: Record<string, string>;
  openChat: (chatId: string) => void;
  loadOlder: (chatId: string) => void;
  hasMore: (chatId: string) => boolean;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendVoice: (chatId: string, recording: VoiceRecording, options?: SendTextOptions) => void;
  /**
   * Toggles my reaction of `emoji` on a message and sends my complete set
   * (XEP-0444). Optimistic; it reverts when the send fails.
   */
  react: (chatId: string, messageId: string, emoji: string) => void;
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
  /**
   * XEP-0444 reaction updates by chat id, keyed by the alias-resolved target
   * message id. Kept even for targets that are not loaded yet.
   */
  reactions: Record<string, ReactionsState>;
  activeChatId: string | undefined;
  historyComplete: Record<string, boolean>;
  /** Group details (people + AIs) by chat id, for the info panel. */
  groupInfos: Record<string, GroupDetail>;
};

export interface ChatStoreSeed {
  currentUserId?: string;
  me?: Me;
  status?: ConnectionStatus;
  chatsState?: ChatsState;
  historyState?: Record<string, HistoryState>;
  contacts?: Contact[];
  chats?: ChatSummary[];
  messagesByChat?: Record<string, UiMessage[]>;
  /** Group details for the mock store; falls back to the bundled mock groups. */
  groupInfos?: Record<string, GroupDetail>;
  /** The AIs the mock user owns, for the add picker; falls back to the bundle. */
  ownedAis?: PublicAi[];
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

// Toggles my reaction on a mock message. Mock data carries the chips directly
// instead of a separate reaction state, so this works on the message itself.
function withToggledReaction(message: UiMessage, emoji: string, name: string): UiMessage {
  const reactions = (message.reactions ?? []).map((reaction) => ({ ...reaction }));
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
  if (index === -1) {
    reactions.push({ emoji, count: 1, mine: true, reactors: [name] });
  } else {
    const reaction = reactions[index];
    if (reaction !== undefined) {
      if (reaction.mine) {
        const count = reaction.count - 1;
        const reactors = reaction.reactors.filter((reactor) => reactor !== name);
        if (count <= 0) {
          reactions.splice(index, 1);
        } else {
          reactions[index] = { ...reaction, count, mine: false, reactors };
        }
      } else {
        reactions[index] = {
          ...reaction,
          count: reaction.count + 1,
          mine: true,
          reactors: [...reaction.reactors, name],
        };
      }
    }
  }
  const next: UiMessage = { ...message };
  if (reactions.length === 0) {
    delete next.reactions;
  } else {
    next.reactions = reactions;
  }
  return next;
}

// The people and AIs of a group as mention members. The mock domain is fixed;
// the real store builds each JID from the signed-in user's domain.
function mentionMembersFor(detail: GroupDetail): MentionMember[] {
  return [
    ...detail.members.map((member) => ({
      jid: `${member.userId.toLowerCase()}@galena.test`,
      name: member.name,
    })),
    ...detail.ais.map((ai) => ({ jid: ai.jid, name: ai.name })),
  ];
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

    // The mock user's JID, so mention matching and the picker's "not me" filter
    // work in mock mode exactly as they do against the real store.
    const meUserId = seed.currentUserId ?? defaultCurrentUserId;
    const ownedAis = seed.ownedAis ?? mockOwnedAis;

    return {
      currentUserId: meUserId,
      me:
        seed.me ??
        ({
          id: meUserId,
          email: 'you@galena.test',
          name: 'You',
          image: null,
          jid: `${meUserId}@galena.test`,
        } satisfies Me),
      status: seed.status ?? 'online',
      // The mock store has no async loads, so its data is ready immediately.
      chatsState: seed.chatsState ?? 'ready',
      historyState: seed.historyState ?? {},
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'ready',
      retryChats: () => {},
      retryHistory: () => {},
      contacts: seed.contacts ?? [],
      chats: seed.chats ?? mockChats,
      messagesByChat: cloneMessages(seed.messagesByChat ?? mockMessages),
      reactions: {},
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: { ...(seed.groupInfos ?? mockGroupDetails) },
      search: '',
      activeFolder: 'all',
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => {
        const detail = get().groupInfos[chatId];
        return detail === undefined ? (mockGroupMembers[chatId] ?? []) : mentionMembersFor(detail);
      },
      groupInfo: (chatId) => get().groupInfos[chatId],
      refreshGroupInfo: () => {},
      listMyAis: async () => ownedAis,
      addGroupAi: async (chatId, aiId) => {
        const ai = ownedAis.find((item) => item.id === aiId);
        if (ai === undefined) {
          throw new Error('That AI no longer exists.');
        }
        set((state) => {
          const detail = state.groupInfos[chatId];
          if (detail === undefined || detail.ais.some((item) => item.aiId === aiId)) {
            return state;
          }
          return {
            groupInfos: {
              ...state.groupInfos,
              [chatId]: {
                ...detail,
                ais: [
                  ...detail.ais,
                  { aiId: ai.id, jid: ai.jid, name: ai.name, ownerId: get().currentUserId },
                ],
              },
            },
          };
        });
      },
      removeGroupAi: async (chatId, aiId) => {
        set((state) => {
          const detail = state.groupInfos[chatId];
          if (detail === undefined || !detail.ais.some((item) => item.aiId === aiId)) {
            return state;
          }
          return {
            groupInfos: {
              ...state.groupInfos,
              [chatId]: { ...detail, ais: detail.ais.filter((item) => item.aiId !== aiId) },
            },
          };
        });
      },
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
      react: (chatId, messageId, emoji) => {
        set((state) => {
          const list = state.messagesByChat[chatId];
          if (list === undefined) {
            return state;
          }
          let updated: UiMessage | undefined;
          const next = list.map((item) => {
            if (item.id !== messageId) {
              return item;
            }
            updated = withToggledReaction(item, emoji, 'You');
            return updated;
          });
          if (updated === undefined) {
            return state;
          }
          return {
            messagesByChat: { ...state.messagesByChat, [chatId]: next },
            chats: withLastMessage(state.chats, chatId, updated),
          };
        });
      },
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
        const mentions = mentionsForTrimmedText(text, trimmed, options?.mentions ?? []);
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          text: trimmed,
          createdAt: new Date(),
          status: 'sending',
          ...(mentions.length === 0 ? {} : { mentions }),
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
