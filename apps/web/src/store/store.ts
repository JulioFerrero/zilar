import type {
  ChatSummary,
  EditsState,
  MentionMember,
  MessageStatus,
  ReactionsState,
  ReplyRef,
  UiMention,
  UiMessage,
} from '@galena/chat-core';
import {
  mentionsForTrimmedText,
  rebaseMentions,
  canEditMessage,
  canDeleteMessage,
} from '@galena/chat-core';
import type {
  Contact,
  CreateTopicInput,
  GroupDetail,
  Me,
  PatchTopicInput,
  PublicAi,
} from '@/lib/api';
import { classify, cleanFilename, objectUrlFor } from '@/lib/attachments';
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
  mockTopicChats,
  mockTopicMessages,
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

/** What the composer passes when it sends a file or image attachment. */
export interface SendAttachmentOptions {
  caption?: string;
  replyTo?: ReplyRef;
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
  /**
   * The short notice shown when the open topic disappeared (made private,
   * archived, or I was removed) and the view moved to General. Cleared
   * when dismissed or when the chat changes. Private topic names never
   * appear in it.
   */
  topicNotice: { chatId: string; message: string } | undefined;
  /** Dismisses the topic notice (or clears a stale one for another chat). */
  dismissTopicNotice: () => void;
  /**
   * Re-reads the chat list from the server (topics included): joins new
   * topic rooms and moves the open view to General when its topic is gone.
   */
  refreshChats: () => void;
  /**
   * Creates a topic in the group that owns `chatId` and opens it. Rejects
   * on failure.
   */
  createTopic: (chatId: string, input: CreateTopicInput) => Promise<string>;
  /**
   * Applies a strip edit (status, owner, link, kind) or a manager edit
   * (name, visibility, archive) to the topic that owns `chatId`, updating
   * the row optimistically with rollback on failure. Rejects on failure.
   */
  patchTopic: (chatId: string, input: PatchTopicInput) => Promise<void>;
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
  /** Flips the group's "members can create topics" switch. Rejects on failure. */
  setMembersCanCreateTopics: (chatId: string, allowed: boolean) => Promise<void>;
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
  /**
   * Opens a chat at one message (message search): loads history until the
   * message is present, then resolves with it. Rejects with
   * `message_not_found` when history runs out first.
   */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  sendText: (chatId: string, text: string, options?: SendTextOptions) => void;
  sendVoice: (chatId: string, recording: VoiceRecording, options?: SendTextOptions) => void;
  sendAttachment: (chatId: string, file: File, options?: SendAttachmentOptions) => void;
  /** Re-runs a failed attachment upload, keeping the original file. */
  retryAttachment: (chatId: string, messageId: string) => void;
  /**
   * Toggles my reaction of `emoji` on a message and sends my complete set
   * (XEP-0444). Optimistic; it reverts when the send fails.
   */
  react: (chatId: string, messageId: string, emoji: string) => void;
  /**
   * The message currently being edited, if any. The composer shows an edit bar
   * for it and Enter saves the new text.
   */
  editTarget: { chatId: string; messageId: string } | undefined;
  /** Starts editing a message (cancels any reply); the composer takes over. */
  startEdit: (chatId: string, messageId: string) => void;
  /** Leaves edit mode without saving. */
  cancelEdit: () => void;
  /**
   * Saves an edit (XEP-0308): the new text is applied optimistically and sent,
   * and reverted when the send fails. An unchanged or empty text sends nothing.
   */
  editMessage: (chatId: string, messageId: string, text: string) => void;
  /**
   * Deletes a message for everyone (XEP-0424). Optimistic, reverted on a send
   * error.
   */
  deleteForEveryone: (chatId: string, messageId: string) => void;
  /** The inline error of the last edit or delete that failed to send. */
  actionError: { chatId: string; message: string } | undefined;
  sendTyping: (chatId: string) => void;
  createGroup: (title: string, memberIds: string[]) => Promise<string>;
  createInvite: () => Promise<string>;
  signOut: () => Promise<void>;
  start: () => void;
  stop: () => void;
  search: string;
  setSearch: (value: string) => void;
  /** Scopes message search to one chat ("Search only in this chat"). */
  searchChat: string | undefined;
  setSearchChat: (chatId: string | undefined) => void;
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
  /**
   * XEP-0308/0424 edit state by chat id, keyed by the alias-resolved target
   * message id. The mock store keeps the flags on the messages instead and
   * leaves this empty.
   */
  edits: Record<string, EditsState>;
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

// Replaces the chat-list preview only when it is the message that changed, so
// editing or deleting an older message never moves the preview.
function withReplacedLastMessage(
  chats: ChatSummary[],
  chatId: string,
  message: UiMessage,
): ChatSummary[] {
  return chats.map((chat) =>
    chat.id === chatId && chat.lastMessage?.id === message.id
      ? { ...chat, lastMessage: message }
      : chat,
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

// T-0111: the mock "Dev team" group carries the mockup's topics. The legacy
// single `c-devteam` row is replaced by its topics (General keeps `c-devteam`
// so old deep links open it). Every other chat stays untouched.
function withMockTopics(chats: ChatSummary[]): ChatSummary[] {
  const topics = mockTopicChats();
  if (topics.length === 0) {
    return chats;
  }
  const generalId = topics.find((topic) => topic.topic?.isGeneral === true)?.id;
  return chats.flatMap((chat) => {
    if (chat.id !== generalId) {
      return [chat];
    }
    return topics;
  });
}

function withMockTopicMessages(messages: Record<string, UiMessage[]>): Record<string, UiMessage[]> {
  return { ...messages, ...mockTopicMessages() };
}

// T-0111: every mock topic chat shares the Dev team group detail (people +
// AIs), so the topic panel, the strip owner picker and the header role
// checks read the same members as the legacy group row did.
function withMockTopicGroupInfos(infos: Record<string, GroupDetail>): Record<string, GroupDetail> {
  const devteam = infos['c-devteam'];
  if (devteam === undefined) {
    return infos;
  }
  const next = { ...infos };
  for (const topic of mockTopicChats()) {
    if (next[topic.id] === undefined) {
      next[topic.id] = devteam;
    }
  }
  return next;
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
    // T-0111: the mock "Dev team" group carries mockup topics. The legacy
    // single `c-devteam` row is replaced by its topics (General keeps the id
    // so old deep links open it); other groups stay single rows. Seeded chats
    // (tests) win over the bundle.
    const seededChats = seed.chats;
    const baseChats = seededChats ?? withMockTopics(mockChats);
    const seededMessages = seed.messagesByChat;
    const baseMessages = seededMessages ?? withMockTopicMessages(mockMessages);

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
      chats: baseChats,
      messagesByChat: cloneMessages(baseMessages),
      reactions: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: seed.groupInfos ?? withMockTopicGroupInfos(mockGroupDetails),
      topicNotice: undefined,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      refreshChats: () => {},
      createTopic: async () => {
        throw new Error('createTopic is not available in the mock store');
      },
      patchTopic: async () => {
        throw new Error('patchTopic is not available in the mock store');
      },
      addTopicAi: async () => {
        throw new Error('addTopicAi is not available in the mock store');
      },
      removeTopicAi: async () => {
        throw new Error('removeTopicAi is not available in the mock store');
      },
      addTopicMember: async () => {
        throw new Error('addTopicMember is not available in the mock store');
      },
      removeTopicMember: async () => {
        throw new Error('removeTopicMember is not available in the mock store');
      },
      leaveTopic: async () => {
        throw new Error('leaveTopic is not available in the mock store');
      },
      setMembersCanCreateTopics: async () => {
        throw new Error('setMembersCanCreateTopics is not available in the mock store');
      },
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
          // Opening another chat dismisses the "topic no longer available"
          // notice (it belongs to the previous view).
          topicNotice: state.topicNotice?.chatId === chatId ? state.topicNotice : undefined,
          chats: state.chats.map((chat) =>
            chat.id === chatId && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
          ),
        })),
      openAtMessage: async (chatId, messageId) => {
        get().openChat(chatId);
        const found = (get().messagesByChat[chatId] ?? []).find((item) => item.id === messageId);
        if (found === undefined) {
          throw new Error('message_not_found');
        }
        return found;
      },
      loadOlder: () => {},
      hasMore: () => false,
      sendTyping: () => {},
      react: (chatId, messageId, emoji) => {
        set((state) => {
          const list = state.messagesByChat[chatId];
          if (list === undefined) {
            return state;
          }
          if (!list.some((item) => item.id === messageId)) {
            return state;
          }
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) =>
                item.id === messageId ? withToggledReaction(item, emoji, 'You') : item,
              ),
            },
          };
        });
      },
      startEdit: (chatId, messageId) => {
        set({ editTarget: { chatId, messageId }, actionError: undefined });
      },
      cancelEdit: () => {
        set({ editTarget: undefined });
      },
      editMessage: (chatId, messageId, text) => {
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          return;
        }
        set((state) => {
          const list = state.messagesByChat[chatId];
          const message = list?.find((item) => item.id === messageId);
          if (list === undefined || message === undefined) {
            return state;
          }
          if (
            !canEditMessage(message, state.currentUserId, new Date()) ||
            message.text === trimmed
          ) {
            return state;
          }
          const mentions = mentionsForTrimmedText(
            text,
            trimmed,
            rebaseMentions(message.text ?? '', text, message.mentions ?? []),
          );
          const edited: UiMessage = { ...message, text: trimmed, edited: true };
          if (mentions.length === 0) {
            delete edited.mentions;
          } else {
            edited.mentions = mentions;
          }
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) => (item.id === messageId ? edited : item)),
            },
            chats: withReplacedLastMessage(state.chats, chatId, edited),
            editTarget: state.editTarget?.messageId === messageId ? undefined : state.editTarget,
          };
        });
      },
      deleteForEveryone: (chatId, messageId) => {
        set((state) => {
          const list = state.messagesByChat[chatId];
          const message = list?.find((item) => item.id === messageId);
          if (list === undefined || message === undefined) {
            return state;
          }
          if (!canDeleteMessage(message, state.currentUserId)) {
            return state;
          }
          const deleted: UiMessage = { ...message, deleted: true };
          delete deleted.text;
          delete deleted.voice;
          delete deleted.image;
          delete deleted.attachment;
          delete deleted.card;
          delete deleted.reactions;
          delete deleted.mentions;
          delete deleted.edited;
          delete deleted.failed;
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: list.map((item) => (item.id === messageId ? deleted : item)),
            },
            chats: withReplacedLastMessage(state.chats, chatId, {
              ...deleted,
              text: 'Message deleted',
            }),
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
      sendAttachment: (chatId, file, options) => {
        if (file.size === 0) {
          return;
        }
        const kind = classify(file);
        const name = cleanFilename(file.name);
        const mime = file.type === '' ? 'application/octet-stream' : file.type;
        const localUrl = kind === 'image' ? objectUrlFor(file) : undefined;
        const caption = options?.caption?.trim() ?? '';
        sequence += 1;
        const message: UiMessage = {
          id: `out-${sequence}`,
          chatId,
          senderId: get().currentUserId,
          senderName: 'You',
          createdAt: new Date(),
          status: 'sending',
          attachment: {
            kind,
            url: localUrl ?? `https://files.galena.test/${encodeURIComponent(name)}`,
            name,
            size: file.size,
            mime,
          },
          ...(caption.length === 0 ? {} : { text: caption }),
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
      retryAttachment: () => {},
      setSearch: (value) => set({ search: value }),
      searchChat: undefined,
      setSearchChat: (chatId) => set({ searchChat: chatId }),
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

/**
 * One sidebar group (T-0111): the group's title plus its topic rows. DMs and
 * AI chats are singleton groups with a stable key.
 */
export interface ChatGroup {
  key: string;
  title: string;
  /** The group's id for avatar + collapse state; undefined for DMs/AIs. */
  groupId: string | undefined;
  topics: ChatSummary[];
}

function groupTitleOf(chat: ChatSummary): string {
  return chat.groupTitle ?? chat.title;
}

/**
 * Folds the flat chat list into sidebar groups: every topic of a group nests
 * under its group header; DMs and AI chats stand alone. General sorts first,
 * then by newest message. Search keeps a group header when any of its topics
 * matches by name. Folders treat a topic like its group (a topic matches when
 * its own row does).
 */
export function groupChats(state: ChatStoreState): ChatGroup[] {
  const query = state.search.trim().toLowerCase();
  const byGroup = new Map<string, ChatSummary[]>();
  const singles: ChatSummary[] = [];
  for (const chat of state.chats) {
    if (!matchesFolder(chat, state.activeFolder)) {
      continue;
    }
    if (chat.topic !== undefined && chat.groupId !== undefined) {
      const list = byGroup.get(chat.groupId) ?? [];
      list.push(chat);
      byGroup.set(chat.groupId, list);
    } else {
      if (query.length > 0 && !chat.title.toLowerCase().includes(query)) {
        continue;
      }
      singles.push(chat);
    }
  }
  const groups: ChatGroup[] = [];
  for (const [groupId, topics] of byGroup) {
    const matching =
      query.length === 0
        ? topics
        : topics.filter((topic) => topic.title.toLowerCase().includes(query));
    if (matching.length === 0) {
      continue;
    }
    const title = groupTitleOf(matching[0] ?? topics[0]!);
    groups.push({ key: `group:${groupId}`, title, groupId, topics: sortTopics(matching) });
  }
  for (const chat of singles) {
    groups.push({ key: `chat:${chat.id}`, title: chat.title, groupId: undefined, topics: [chat] });
  }
  return groups;
}

function topicTime(chat: ChatSummary): number {
  return chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortTopics(topics: ChatSummary[]): ChatSummary[] {
  return [...topics].sort((left, right) => {
    const leftGeneral = left.topic?.isGeneral === true;
    const rightGeneral = right.topic?.isGeneral === true;
    if (leftGeneral !== rightGeneral) {
      return leftGeneral ? -1 : 1;
    }
    return topicTime(right) - topicTime(left) || left.title.localeCompare(right.title);
  });
}

export function folderUnread(state: ChatStoreState, folder: FolderId): number {
  return state.chats
    .filter((chat) => matchesFolder(chat, folder))
    .reduce((total, chat) => total + chat.unread, 0);
}
