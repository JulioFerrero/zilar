// effect-plain: in-memory mock store for demos and tests
import type { MentionMember, MessageStatus, UiMessage } from '@zilar/chat-core';
import { defaultFolders, sortFolders, splitLinks } from '@zilar/chat-core';
import { StickerSchema, isValid } from '@zilar/protocol';
import { createBoundStore, type UseBoundStore } from './atomStore';
import type {
  CreatedInviteLink,
  CreateGroupInviteLinkInput,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';
import { attachmentDataFor } from '../lib/attachments';
import { GroupsApiError } from '../lib/groups-api';
import { imageGradient } from '../lib/image-presets';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from '../lib/types';
import type { CustomGroupRole } from '../lib/roles-api';
import type { ApproverRole, TopicRole } from '../lib/topics-api';
import { chatSeeds, mockChats, mockMessagesByChat } from '../mock';
import { createMockInviteLinksStore } from '../mock/invite-links';
import {
  mockDevteamGroupDetail,
  mockDevteamOwnedAis,
  mockGroupRoles,
  mockMemberName,
  mockTopicAisById,
  mockTopicRolesOf,
} from '../mock/topics';
import { mockChannelChats, mockChannelDetail, resetMockChannels } from '../mock/channel';
import { mockListPins, resetMockPins } from '../mock/pins';
import { resetMockChatPrefs } from '../mock/chat-prefs';
import { createMockDirectoryApi } from '../mock/directory';
import { mockContacts } from '../mock/contacts';
import { mockParamAllowed } from '../mock/gate';
import {
  MOCK_DRAFT_CHAT_ID,
  MOCK_DRAFT_FINAL_MESSAGE_ID,
  MOCK_DRAFT_STREAM_TEXT,
  MOCK_DRAFT_TURN_ID,
  createMockDraftFinalMessage,
  readMockDraftPhase,
  type MockDraftPhase,
} from '../mock/drafts';
import { MOCK_LOAD_DELAY_MS, readMockLoadScenario, type MockLoadScenario } from '../mock/load';
import type { ChatStoreState, LoadState } from './types';
import type { Pin } from '../lib/pins-api';
import type { MediaItem, MediaTab } from '../lib/media-api';

/** Simulated send states, from T-0018 step 5. */
export const SENT_DELAY_MS = 300;
export const READ_DELAY_MS = 1500;

/** The mock-mode size cap: the same 50 MiB as the server upload limit. */
export const MAX_MOCK_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Mock typing simulation, mirroring the web app (T-0022). */
export const TYPING_START_MS = 2000;
export const TYPING_DURATION_MS = 4000;

const NO_MESSAGES: UiMessage[] = [];

/** The data fields of the store, without the actions. */
type ChatStoreData = Omit<
  ChatStoreState,
  | 'messages'
  | 'openChat'
  | 'openAtMessage'
  | 'clearJumpTarget'
  | 'loadOlder'
  | 'reloadChats'
  | 'retryHistory'
  | 'hasMore'
  | 'sendText'
  | 'sendAttachment'
  | 'retryAttachment'
  | 'cancelAttachment'
  | 'sendVoice'
  | 'retryVoice'
  | 'cancelVoice'
  | 'sendSticker'
  | 'retrySticker'
  | 'forwardMessages'
  | 'sendTyping'
  | 'react'
  | 'startEdit'
  | 'cancelEdit'
  | 'editMessage'
  | 'deleteForEveryone'
  | 'dismissActionError'
  | 'dismissTopicNotice'
  | 'groupDetail'
  | 'ensureGroupDetail'
  | 'refreshGroupDetail'
  | 'setChatPref'
  | 'pins'
  | 'refreshPins'
  | 'pinFor'
  | 'canPin'
  | 'pinMessage'
  | 'unpinMessage'
  | 'dismissPinsError'
  | 'stopPinsPoll'
  | 'loadChatMedia'
  | 'createTopic'
  | 'patchTopic'
  | 'archiveTopic'
  | 'addTopicAi'
  | 'removeTopicAi'
  | 'addTopicMember'
  | 'removeTopicMember'
  | 'leaveTopic'
  | 'listTopicMembers'
  | 'listTopicAis'
  | 'listInviteLinks'
  | 'createInviteLink'
  | 'revokeInviteLink'
  | 'createChannel'
  | 'createGroup'
  | 'leaveChannel'
  | 'listChannelMembers'
  | 'changeChannelRole'
  | 'previewJoinLink'
  | 'joinByLink'
  | 'groupRoles'
  | 'refreshGroupRoles'
  | 'createGroupRole'
  | 'renameGroupRole'
  | 'deleteGroupRole'
  | 'setGroupRoleMembers'
  | 'topicRoles'
  | 'refreshTopicRoles'
  | 'setTopicRoles'
  | 'setSearch'
  | 'setActiveFolder'
  | 'setFolders'
  | 'createFolder'
  | 'updateFolder'
  | 'deleteFolder'
  | 'reorderFolders'
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

export function createInitialState(phase?: MockDraftPhase, load?: MockLoadScenario): ChatStoreData {
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
  // The mock store is loaded at once, except in the T-0067 screenshot scenarios.
  const loadedHistory: Record<string, LoadState> = Object.fromEntries(
    mockChats.map((chat) => [chat.id, 'loaded']),
  );
  const base: ChatStoreData = {
    currentUserId: CURRENT_USER_ID,
    me: undefined,
    status: 'online',
    chatsLoad: 'loaded',
    chats,
    contacts: mockContacts.map((contact) => ({ ...contact })),
    messagesByChat,
    historyLoad: loadedHistory,
    search: '',
    activeFolder: 'all',
    folders: defaultFolders(),
    // The mock store is loaded at once, so its folders are already known.
    foldersLoaded: true,
    activeChatId: null,
    historyComplete: {},
    jumpTarget: undefined,
    typing: {},
    edits: {},
    reactions: {},
    drafts:
      phase === 'stream'
        ? { [MOCK_DRAFT_CHAT_ID]: { turnId: MOCK_DRAFT_TURN_ID, text: MOCK_DRAFT_STREAM_TEXT } }
        : {},
    finishedDraftMessages:
      phase === 'final' ? { [MOCK_DRAFT_FINAL_MESSAGE_ID]: MOCK_DRAFT_TURN_ID } : {},
    editTarget: undefined,
    actionError: undefined,
    mediaTrustedHosts: undefined,
    topicNotice: undefined,
    groupDetailsRevision: 0,
    // T-0227: the mock `groupMembers` reads the mock detail through
    // `get()`, so the initial data needs no member list.
    groupMembers: () => [],
    groupIdForChat: (chatId) => chats.find((entry) => entry.id === chatId)?.groupId,
    ownedAis: mockDevteamOwnedAis(),
    pinsError: undefined,
  };
  if (load === 'slow') {
    return { ...base, chats: [], chatsLoad: 'loading', messagesByChat: {}, historyLoad: {} };
  }
  if (load === 'error') {
    return {
      ...base,
      chatsLoad: 'error',
      historyLoad: Object.fromEntries(mockChats.map((chat) => [chat.id, 'error'])),
    };
  }
  if (load === 'empty') {
    return { ...base, chats: [], chatsLoad: 'loaded', messagesByChat: {}, historyLoad: {} };
  }
  if (load === 'no-messages') {
    return { ...base, chats: chatSeeds.map((seed) => ({ ...seed })), messagesByChat: {} };
  }
  return base;
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

/**
 * The mock pins read by the mock store's `pins` selector. `refreshPins`
 * and the pin/unpin actions rewrite one chat's entry; `resetMockPins`
 * (called when a mock store is created) clears the whole cache.
 */
const mockPinsRead: Record<string, Pin[]> = {};

// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_PINS: Pin[] = [];

/**
 * Whether a public handle is taken in the mock directory (T-0234): the mock
 * creates reject with the same `handle_taken` error the real store surfaces,
 * so the sheet shows "That handle was just taken."
 */
async function mockHandleTaken(handle: string): Promise<boolean> {
  const wanted = handle.trim();
  if (wanted === '') {
    return false;
  }
  const check = await createMockDirectoryApi().checkGroupHandle(wanted);
  return !check.available;
}

function mockPinsFor(chatId: string): Pin[] {
  return mockPinsRead[chatId] ?? EMPTY_PINS;
}

function setPinsCache(chatId: string, pins: Pin[]): void {
  mockPinsRead[chatId] = pins;
}

function linkHostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Builds one tab of the mock gallery from a chat's messages, newest first
 * (T-0436). It mirrors the server's indexer: an image (or image attachment)
 * is media, a file attachment is a file, a voice payload is a voice message
 * and every http(s) URL in a text body is one link row. Retracted messages
 * drop out, and the mock never pages (`next` is always null).
 */
function mockMediaItems(messages: readonly UiMessage[], tab: MediaTab): MediaItem[] {
  const items: MediaItem[] = [];
  for (const message of messages) {
    if (message.deleted === true) {
      continue;
    }
    const base = {
      messageId: message.id,
      chat: message.chatId,
      at: message.createdAt.toISOString(),
      senderName: message.senderName,
    };
    if (tab === 'media' && message.image !== undefined) {
      items.push({
        ...base,
        kind: 'image',
        url: message.image.url,
        width: message.image.width,
        height: message.image.height,
      });
    } else if (tab === 'media' && message.attachment?.kind === 'image') {
      items.push({
        ...base,
        kind: 'image',
        url: message.attachment.url,
        name: message.attachment.name,
        size: message.attachment.size,
        mime: message.attachment.mime,
        ...(message.attachment.width === undefined ? {} : { width: message.attachment.width }),
        ...(message.attachment.height === undefined ? {} : { height: message.attachment.height }),
      });
    } else if (tab === 'files' && message.attachment?.kind === 'file') {
      items.push({
        ...base,
        kind: 'file',
        url: message.attachment.url,
        name: message.attachment.name,
        size: message.attachment.size,
        mime: message.attachment.mime,
      });
    } else if (tab === 'voice' && message.voice !== undefined) {
      items.push({
        ...base,
        kind: 'voice',
        ...(message.voice.url === undefined ? {} : { url: message.voice.url }),
        durationMs: message.voice.duration_ms,
        waveform: [...message.voice.waveform],
        mime: message.voice.mime,
      });
    } else if (tab === 'links' && message.text !== undefined) {
      for (const segment of splitLinks(message.text)) {
        if (segment.kind !== 'link') {
          continue;
        }
        const host = linkHostOf(segment.href);
        items.push({
          ...base,
          kind: 'link',
          linkUrl: segment.href,
          ...(host === undefined ? {} : { linkHost: host }),
        });
      }
    }
  }
  return items.reverse();
}

/** The mock store kept for `?mock=1` dev mode and unit tests. */
export function createChatStore(
  phase: MockDraftPhase | undefined = readMockDraftPhase(),
  load: MockLoadScenario | undefined = readMockLoadScenario(),
): UseBoundStore<ChatStoreState> {
  return createBoundStore<ChatStoreState>((set, get) => {
    // In-memory custom roles (T-0137): each mock store gets its own copy of
    // the seeded Designers/Devs roles, plus the attached roles + approver
    // role per topic id. Writes mutate the copies and bump
    // `groupDetailsRevision` so the `groupRoles`/`topicRoles` selectors
    // re-fire, like the real store.
    const mockRoles: CustomGroupRole[] = mockGroupRoles();
    const mockTopicRoles = new Map<
      string,
      { roles: TopicRole[]; approverRole: ApproverRole | null }
    >();
    let mockRoleSequence = 1;
    // Mock folder ids, so a create can be deleted or renamed within a session.
    let mockFolderSequence = 1;

    const bumpRolesRevision = () =>
      set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));

    // The roles selectors hand out copies, cached per revision so a
    // selector returns the same reference until a write bumps it (a fresh
    // copy on every call would loop React forever).
    let rolesSnapshot: { revision: number; roles: CustomGroupRole[] } | undefined;
    // T-0144: channels share this cache (one entry per group id, so screens
    // reading different groups never evict each other) — `mockChannelDetail`
    // returns the devteam shape plus `kind`/`description`, so the union
    // covers both.
    const detailSnapshots = new Map<
      string,
      {
        revision: number;
        value:
          | ReturnType<typeof mockDevteamGroupDetail>
          | NonNullable<ReturnType<typeof mockChannelDetail>>;
      }
    >();
    const topicRolesSnapshots = new Map<
      string,
      {
        revision: number;
        value: { roles: TopicRole[]; approverRole: ApproverRole | null };
      }
    >();

    const findMockRole = (roleId: string): CustomGroupRole | undefined =>
      mockRoles.find((role) => role.id === roleId);

    const topicRolesOf = (
      topicId: string,
    ): { roles: TopicRole[]; approverRole: ApproverRole | null } => {
      const cached = mockTopicRoles.get(topicId);
      if (cached !== undefined) {
        return cached;
      }
      const seeded = mockTopicRolesOf(topicId);
      const entry = {
        roles: seeded.roles.map((role) => ({ ...role })),
        approverRole: seeded.approverRole === null ? null : { ...seeded.approverRole },
      };
      mockTopicRoles.set(topicId, entry);
      return entry;
    };

    const refreshMockTopicRoleCounts = () => {
      for (const [topicId, entry] of mockTopicRoles) {
        mockTopicRoles.set(topicId, {
          ...entry,
          roles: entry.roles.map((role) => {
            const live = findMockRole(role.id);
            return live === undefined
              ? role
              : { ...role, name: live.name, memberCount: live.members.length };
          }),
        });
      }
    };
    // Each mock store starts from the seeded mock data (T-0135): the pin
    // seeds and any pref writes from an earlier store never leak across.
    // T-0144: channel role writes reset too.
    resetMockChatPrefs();
    resetMockPins();
    resetMockChannels();
    for (const chatId of Object.keys(mockPinsRead)) {
      delete mockPinsRead[chatId];
    }
    // T-0144: the feed rows re-read their `myRole` from the channel module
    // after a role write below, so a promoted viewer flips the composer.
    // In-memory only, like the rest of the mock store.
    const refreshMockChannelChats = () => {
      const byId = new Map(mockChannelChats().map((chat) => [chat.id, chat]));
      set((state) => ({
        chats: state.chats.map((chat) => byId.get(chat.id) ?? chat),
      }));
    };

    // Drops the `failed` flag without leaving an `undefined` value behind.
    function clearMockFailure(message: UiMessage): UiMessage {
      if (message.failed === undefined) {
        return message;
      }
      const next: UiMessage = { ...message };
      delete next.failed;
      return next;
    }

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

    // The mock invite-links backend (T-0136): create, list, revoke, preview
    // and join against in-memory links, so the manage and join UI work in
    // mock mode without a server. `alreadyMember` comes from the store's
    // group detail (like the server's membership check), so a link for a
    // group the viewer is not in exercises the real Join path.
    const inviteLinks = createMockInviteLinksStore({
      isMember: (groupId) =>
        get()
          .groupDetail(groupId)
          ?.members.some((member) => member.userId === get().currentUserId) === true,
    });

    // The `slow` scenario is the only one that settles: the real list arrives
    // after the delay, the same way a slow backend would.
    if (load === 'slow') {
      setTimeout(() => {
        const loaded = createInitialState(phase);
        set({
          chats: loaded.chats,
          messagesByChat: loaded.messagesByChat,
          chatsLoad: 'loaded',
          historyLoad: loaded.historyLoad,
        });
      }, MOCK_LOAD_DELAY_MS);
    }

    return {
      ...createInitialState(phase, load),
      messages: (chatId) => get().messagesByChat[chatId] ?? NO_MESSAGES,
      hasMore: () => false,
      loadOlder: () => {},
      groupMembers: (chatId) => {
        // The mock twin of the real store's `mentionMembersFor` (T-0227):
        // the members of the detail behind the chat's group id plus the
        // group's AIs, never yourself (by `userId`: `me` is never set in
        // mock mode, while `currentUserId` always is). The domain is fixed
        // in mock mode, like the token's.
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId;
        if (groupId === undefined) {
          return [];
        }
        const detail = get().groupDetail(groupId);
        if (detail === undefined) {
          return [];
        }
        const meId = get().currentUserId;
        const members: MentionMember[] = [];
        for (const member of detail.members) {
          if (member.userId === meId) {
            continue;
          }
          members.push({
            jid: `${member.userId.toLowerCase()}@zilar.test`,
            name: member.name,
            ...(member.handle === undefined || member.handle === ''
              ? {}
              : { handle: member.handle }),
          });
        }
        for (const ai of detail.ais) {
          members.push({ jid: ai.jid, name: ai.name });
        }
        return members;
      },
      reloadChats: () => set({ chatsLoad: 'loaded' }),
      retryHistory: (chatId) =>
        set((state) => ({ historyLoad: { ...state.historyLoad, [chatId]: 'loaded' } })),
      sendTyping: () => {},
      react: () => {},
      startEdit: () => {},
      cancelEdit: () => {},
      editMessage: () => {},
      deleteForEveryone: () => {},
      dismissActionError: () => {},
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      groupDetailsRevision: 0,
      groupDetail: (groupId) => {
        const revision = get().groupDetailsRevision;
        if (groupId === 'g-devteam' || groupId === 'g-acme' || groupId === 'g-studio') {
          let snapshot = detailSnapshots.get(groupId);
          if (snapshot?.revision !== revision) {
            const channel = mockChannelDetail(groupId);
            snapshot = { revision, value: channel ?? mockDevteamGroupDetail() };
            detailSnapshots.set(groupId, snapshot);
          }
          return snapshot.value;
        }
        return undefined;
      },
      refreshGroupDetail: () => {},
      ensureGroupDetail: () => {},
      ownedAis: mockDevteamOwnedAis(),
      pinsError: undefined,
      setChatPref: async (chatId, input) => {
        // The mock goes through the in-memory mock API and re-merges the
        // saved truth (a null answer drops the row), like the web mock store.
        const { mockListChatPrefs, mockPutChatPref } = await import('../mock/chat-prefs');
        const { applyChatPrefs, optimisticPrefRow } = await import('../lib/chat-prefs');
        const now = Date.now();
        // Optimistic: merge the intended row into a copy of the full mock
        // rows first, like the real store. Merging a single row built from
        // the partial input would strip every other chat's prefs and drop
        // this chat's kept fields until the saved truth below replaces it.
        const rows = mockListChatPrefs();
        set((state) => ({
          chats: applyChatPrefs(
            state.chats,
            [
              ...rows.filter((row) => row.chatJid.toLowerCase() !== chatId.toLowerCase()),
              optimisticPrefRow(chatId, rows, input, new Date(now)),
            ],
            now,
          ),
        }));
        mockPutChatPref(chatId, input, new Date(now));
        const truth = mockListChatPrefs();
        set((state) => ({ chats: applyChatPrefs(state.chats, truth, Date.now()) }));
      },
      pins: (chatId) => {
        // Pins are synchronous per-row reads on the in-memory mock list, so
        // the selector stays synchronous. Reading the error subscribes the
        // selector to pin loads, like `groupDetail` does with its revision.
        void get().pinsError;
        return mockPinsFor(chatId);
      },
      refreshPins: (chatId) => {
        setPinsCache(chatId, mockListPins(chatId));
        set({ pinsError: undefined });
        return Promise.resolve();
      },
      pinFor: (chatId, messageId) => mockPinsFor(chatId).find((pin) => pin.messageId === messageId),
      canPin: (chatId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return false;
        }
        // Either side of a DM may pin.
        if (chat.kind === 'dm') {
          return true;
        }
        // A topic manager: the mock viewer owns the Dev team group (see
        // `mockDevteamGroupDetail`), so topics there may pin. The
        // topic-creator-who-is-a-plain-member edge is server-enforced only.
        if (chat.topic !== undefined && chat.groupId === 'g-devteam') {
          return true;
        }
        return false;
      },
      pinMessage: async (chatId, messageId) => {
        const state = get();
        if (!state.canPin(chatId)) {
          throw new Error('You cannot pin here.');
        }
        const message = state.messagesByChat[chatId]?.find((item) => item.id === messageId);
        if (message === undefined) {
          throw new Error('Message not found');
        }
        const { mockPinMessage } = await import('../mock/pins');
        const { pinKindFor, pinSnapshotText } = await import('../lib/pins-api');
        const shape = {
          text: message.text,
          image: message.image,
          voice: message.voice,
          card: message.card,
          attachment: message.attachment,
        };
        const pin = mockPinMessage({
          chat: chatId,
          messageId,
          senderName: message.senderName,
          text: pinSnapshotText({ ...shape, deleted: message.deleted }),
          kind: pinKindFor(shape),
        });
        // The cache stays newest-first like the server: the banner shows
        // the latest pin.
        setPinsCache(chatId, [pin, ...mockPinsFor(chatId)]);
        set({ pinsError: undefined });
      },
      unpinMessage: async (chatId, pinId) => {
        const { mockUnpinMessage } = await import('../mock/pins');
        const removed = mockUnpinMessage(pinId);
        if (removed === undefined) {
          set({ pinsError: { chatId, message: 'Could not unpin. Try again.' } });
          throw new Error('Pin not found');
        }
        setPinsCache(
          chatId,
          mockPinsFor(chatId).filter((pin) => pin.id !== pinId),
        );
        set({ pinsError: undefined });
      },
      dismissPinsError: () => set({ pinsError: undefined }),
      // Mock mode has no background poll: leaving a chat is a no-op for
      // pins (the cache stays until the next open re-reads the seeds).
      stopPinsPoll: () => {},
      loadChatMedia: (chatId, tab) =>
        Promise.resolve({
          items: mockMediaItems(get().messagesByChat[chatId] ?? NO_MESSAGES, tab),
          next: null,
        }),
      createTopic: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId;
        if (groupId === undefined) {
          throw new Error('This group is not available yet.');
        }
        messageCounter += 1;
        const roomId = `t-mock-${Date.now()}-${messageCounter}`;
        const topicId = roomId;
        const visibility = input.visibility ?? 'public';
        const next: (typeof mockChats)[number] = {
          id: roomId,
          title: input.name,
          kind: 'group',
          isAI: false,
          space: chat?.space ?? 'personal',
          unread: 0,
          muted: false,
          memberCount: chat?.memberCount ?? 2,
          onlineCount: 0,
          groupId,
          groupTitle: chat?.groupTitle ?? chat?.title ?? 'Group',
          topic: {
            id: topicId,
            glyph: [...input.name.trim()][0]?.toUpperCase() ?? 'G',
            kind: input.kind ?? 'chat',
            status: 'open',
            visibility,
            isGeneral: false,
            archived: false,
            owner: null,
            linkUrl: null,
            linkLabel: null,
          },
        };
        // A new topic starts with no roles attached (T-0137).
        mockTopicRoles.set(topicId, { roles: [], approverRole: null });
        set((state) => ({
          chats: [next, ...state.chats],
          messagesByChat: { ...state.messagesByChat, [roomId]: [] },
          historyLoad: { ...state.historyLoad, [roomId]: 'loaded' },
        }));
        return roomId;
      },
      patchTopic: async (chatId, input) => {
        const before = get().chats.find((entry) => entry.id === chatId);
        const topicId = before?.topic?.id;
        // Going public clears the attached roles and the approver role, like
        // the server: re-privatizing never brings them back silently.
        if (
          topicId !== undefined &&
          before?.topic?.visibility === 'private' &&
          input.visibility === 'public'
        ) {
          mockTopicRoles.set(topicId, { roles: [], approverRole: null });
          bumpRolesRevision();
        }
        set((state) => ({
          chats: state.chats.map((entry) => {
            if (entry.id !== chatId || entry.topic === undefined) {
              return entry;
            }
            return {
              ...entry,
              ...(input.name === undefined ? {} : { title: input.name }),
              topic: {
                ...entry.topic,
                ...(input.kind === undefined ? {} : { kind: input.kind }),
                ...(input.status === undefined ? {} : { status: input.status }),
                ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
                ...(input.owner === undefined
                  ? {}
                  : {
                      owner:
                        input.owner === null
                          ? null
                          : {
                              kind: input.owner.kind,
                              id: input.owner.id,
                              // The mock has no member directory: keep the
                              // current display name when re-setting the same
                              // owner, else fall back to the id.
                              name:
                                entry.topic?.owner?.id === input.owner.id
                                  ? (entry.topic?.owner?.name ?? input.owner.id)
                                  : input.owner.id,
                            },
                    }),
                ...(input.linkUrl === undefined ? {} : { linkUrl: input.linkUrl }),
                ...(input.linkLabel === undefined ? {} : { linkLabel: input.linkLabel }),
                ...(input.archived === undefined ? {} : { archived: input.archived }),
              },
            };
          }),
        }));
      },
      archiveTopic: async (chatId) => {
        set((state) => ({
          chats: state.chats.filter((entry) => entry.id !== chatId),
        }));
      },
      addTopicAi: async () => {
        // T-0112 should-fix: the mock new-topic sheet ticks AIs (the viewer
        // owns two in the Dev team group), so adding one must not throw.
        // Like `createTopic` above, this stays in memory only.
      },
      removeTopicAi: async () => {
        throw new Error('removeTopicAi is not available in the mock store');
      },
      addTopicMember: async () => {
        throw new Error('addTopicMember is not available in the mock store');
      },
      removeTopicMember: async (chatId, userId) => {
        if (userId === get().currentUserId) {
          set((state) => ({
            chats: state.chats.filter((entry) => entry.id !== chatId),
          }));
        }
      },
      leaveTopic: async (chatId) => {
        await get().removeTopicMember(chatId, get().currentUserId);
      },
      listTopicMembers: async (chatId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const topicId = chat?.topic?.id;
        if (topicId !== undefined) {
          const { mockTopicMembersById } = await import('../mock/topics');
          const members = mockTopicMembersById()[topicId];
          if (members !== undefined) {
            return members;
          }
        }
        return [];
      },
      listTopicAis: async (chatId) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const topicId = chat?.topic?.id;
        if (topicId === undefined) {
          return [];
        }
        return mockTopicAisById()[topicId] ?? [];
      },
      listInviteLinks: async (groupId: string) => inviteLinks.list(groupId),
      createInviteLink: async (
        groupId: string,
        input: CreateGroupInviteLinkInput,
      ): Promise<CreatedInviteLink> => inviteLinks.create(groupId, input),
      revokeInviteLink: async (groupId: string, linkId: string): Promise<void> => {
        inviteLinks.revoke(groupId, linkId);
      },
      createChannel: async (input: {
        title: string;
        description?: string;
        visibility?: 'public';
        handle?: string;
      }) => {
        const trimmed = input.title.trim();
        if (trimmed === '') {
          throw new Error('Enter a channel name.');
        }
        if (input.description !== undefined && input.description.length > 300) {
          throw new Error('The description must be at most 300 characters.');
        }
        const publicHandle =
          input.visibility === 'public' && input.handle !== undefined
            ? input.handle.trim()
            : undefined;
        if (publicHandle !== undefined && (await mockHandleTaken(publicHandle))) {
          throw new GroupsApiError(409, 'handle_taken', 'That handle is taken');
        }
        messageCounter += 1;
        const groupId = `g-mock-${Date.now()}-${messageCounter}`;
        const feedId = `c-${groupId}`;
        const description = input.description?.trim() ?? '';
        set((state) => ({
          chats: [
            {
              id: feedId,
              title: trimmed,
              kind: 'group',
              isAI: false,
              space: 'personal',
              unread: 0,
              muted: false,
              memberCount: 1,
              onlineCount: 0,
              chatKind: 'channel',
              subscriberCount: 1,
              description: description === '' ? null : description,
              ...(publicHandle === undefined
                ? {}
                : { visibility: 'public' as const, handle: publicHandle }),
              myRole: 'owner',
              groupId,
              groupTitle: trimmed,
              topic: {
                id: `t-${feedId}`,
                glyph: [...trimmed][0]?.toUpperCase() ?? 'C',
                kind: 'chat',
                status: 'open',
                visibility: publicHandle === undefined ? 'private' : 'public',
                isGeneral: true,
                archived: false,
                owner: null,
                linkUrl: null,
                linkLabel: null,
              },
            },
            ...state.chats,
          ],
          messagesByChat: { ...state.messagesByChat, [feedId]: [] },
          historyLoad: { ...state.historyLoad, [feedId]: 'loaded' },
        }));
        return groupId;
      },
      createGroup: async (input: {
        title: string;
        memberIds: string[];
        visibility?: 'public';
        handle?: string;
      }) => {
        const trimmed = input.title.trim();
        if (trimmed === '') {
          throw new Error('Enter a group name.');
        }
        const publicHandle =
          input.visibility === 'public' && input.handle !== undefined
            ? input.handle.trim()
            : undefined;
        if (publicHandle !== undefined && (await mockHandleTaken(publicHandle))) {
          throw new GroupsApiError(409, 'handle_taken', 'That handle is taken');
        }
        messageCounter += 1;
        const groupId = `g-mock-${Date.now()}-${messageCounter}`;
        const chatId = `mock-group-${messageCounter}`;
        set((state) => ({
          chats: [
            {
              id: chatId,
              title: trimmed,
              kind: 'group',
              isAI: false,
              space: 'personal',
              unread: 0,
              muted: false,
              memberCount: input.memberIds.length + 1,
              onlineCount: 0,
              ...(publicHandle === undefined
                ? {}
                : { visibility: 'public' as const, handle: publicHandle }),
              groupId,
              groupTitle: trimmed,
              topic: {
                id: `t-${chatId}`,
                glyph: [...trimmed][0]?.toUpperCase() ?? 'G',
                kind: 'chat',
                status: 'open',
                visibility: publicHandle === undefined ? 'private' : 'public',
                isGeneral: true,
                archived: false,
                owner: null,
                linkUrl: null,
                linkLabel: null,
              },
            },
            ...state.chats,
          ],
          messagesByChat: { ...state.messagesByChat, [chatId]: [] },
          historyLoad: { ...state.historyLoad, [chatId]: 'loaded' },
        }));
        return groupId;
      },
      leaveChannel: async (chatId) => {
        // T-0144: mock channels are topic groups (see `mock/channel.ts`);
        // leaving removes the feed row like `archiveTopic` removes a topic.
        set((state) => ({
          chats: state.chats.filter((entry) => entry.id !== chatId),
        }));
      },
      listChannelMembers: async (groupId) => {
        // T-0144: the mock detail mirrors the server rule — managers read
        // the full audience, subscribers the owner/admins slice.
        const detail = get().groupDetail(groupId);
        const meId = get().currentUserId;
        const myRole = detail?.members.find((member) => member.userId === meId)?.role;
        const members = detail?.members ?? [];
        if (myRole === 'owner' || myRole === 'admin') {
          return members.map((member) => ({
            userId: member.userId,
            name: member.name,
            role: member.role,
          }));
        }
        return members
          .filter((member) => member.role !== 'member')
          .map((member) => ({
            userId: member.userId,
            name: member.name,
            role: member.role,
          }));
      },
      changeChannelRole: async (chatId, userId, role) => {
        // T-0144: in-memory promote/demote on the channel detail snapshot.
        // The mock snapshot is rebuilt from the seed per revision, so the
        // write must land in module state — delegate to `mock/channel.ts`.
        const { mockChangeChannelRole } = await import('../mock/channel');
        const chat = get().chats.find((entry) => entry.id === chatId);
        const groupId = chat?.groupId;
        if (groupId === undefined) {
          throw new Error('This channel is not available yet.');
        }
        const myRole = get()
          .groupDetail(groupId)
          ?.members.find((member) => member.userId === get().currentUserId)?.role;
        if (myRole !== 'owner') {
          throw Object.assign(new Error('Only group owners and admins can change roles.'), {
            status: 404,
            code: 'not_found',
          });
        }
        mockChangeChannelRole(groupId, userId, role);
        set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));
        refreshMockChannelChats();
      },
      previewJoinLink: async (token: string): Promise<JoinPreview> => inviteLinks.preview(token),
      joinByLink: async (token: string): Promise<JoinResult> => inviteLinks.join(token),
      groupRoles: (groupId) => {
        const revision = get().groupDetailsRevision;
        if (groupId !== 'g-devteam') {
          return undefined;
        }
        if (rolesSnapshot?.revision !== revision) {
          rolesSnapshot = { revision, roles: mockRoles.map((role) => ({ ...role })) };
        }
        return rolesSnapshot.roles;
      },
      refreshGroupRoles: async () => {},
      createGroupRole: async (groupId, name) => {
        if (groupId !== 'g-devteam') {
          throw new Error('This group is not available yet.');
        }
        const trimmed = name.trim().slice(0, 30);
        if (trimmed === '') {
          throw new Error('Enter a role name.');
        }
        if (mockRoles.some((role) => role.name.toLowerCase() === trimmed.toLowerCase())) {
          throw new Error('A role with that name already exists.');
        }
        const role: CustomGroupRole = {
          id: `role-mock-${mockRoleSequence}`,
          name: trimmed,
          members: [],
        };
        mockRoleSequence += 1;
        mockRoles.push(role);
        bumpRolesRevision();
        return { ...role };
      },
      renameGroupRole: async (_groupId, roleId, name) => {
        const role = findMockRole(roleId);
        if (role === undefined) {
          throw new Error('That role is no longer here.');
        }
        const trimmed = name.trim().slice(0, 30);
        if (trimmed === '') {
          throw new Error('Enter a role name.');
        }
        if (
          mockRoles.some(
            (entry) => entry.id !== roleId && entry.name.toLowerCase() === trimmed.toLowerCase(),
          )
        ) {
          throw new Error('A role with that name already exists.');
        }
        role.name = trimmed;
        refreshMockTopicRoleCounts();
        bumpRolesRevision();
        return { ...role, members: [...role.members] };
      },
      deleteGroupRole: async (_groupId, roleId) => {
        const index = mockRoles.findIndex((role) => role.id === roleId);
        if (index === -1) {
          throw new Error('That role is no longer here.');
        }
        mockRoles.splice(index, 1);
        for (const [topicId, entry] of mockTopicRoles) {
          mockTopicRoles.set(topicId, {
            roles: entry.roles.filter((role) => role.id !== roleId),
            approverRole: entry.approverRole?.id === roleId ? null : entry.approverRole,
          });
        }
        bumpRolesRevision();
      },
      setGroupRoleMembers: async (_groupId, roleId, userIds) => {
        const role = findMockRole(roleId);
        if (role === undefined) {
          throw new Error('That role is no longer here.');
        }
        role.members = [...new Set(userIds)].map((userId) => ({
          userId,
          name: mockMemberName(userId),
        }));
        refreshMockTopicRoleCounts();
        bumpRolesRevision();
        return { ...role, members: [...role.members] };
      },
      topicRoles: (chatId) => {
        const revision = get().groupDetailsRevision;
        const topicId = get().chats.find((entry) => entry.id === chatId)?.topic?.id;
        if (topicId === undefined) {
          return undefined;
        }
        const cached = topicRolesSnapshots.get(topicId);
        if (cached !== undefined && cached.revision === revision) {
          return cached.value;
        }
        const entry = topicRolesOf(topicId);
        const value = {
          roles: entry.roles.map((role) => ({ ...role })),
          approverRole: entry.approverRole === null ? null : { ...entry.approverRole },
        };
        topicRolesSnapshots.set(topicId, { revision, value });
        return value;
      },
      refreshTopicRoles: async (chatId) => {
        const topicId = get().chats.find((entry) => entry.id === chatId)?.topic?.id;
        if (topicId !== undefined) {
          topicRolesOf(topicId);
        }
      },
      setTopicRoles: async (chatId, input) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        const topicId = chat?.topic?.id;
        if (topicId === undefined) {
          throw new Error('This topic is not available yet.');
        }
        if (chat?.topic?.visibility !== 'private') {
          throw new Error('Only private topics have roles.');
        }
        const wanted = [...new Set(input.roleIds)];
        const roles: TopicRole[] = [];
        for (const id of wanted) {
          const live = findMockRole(id);
          if (live === undefined) {
            throw new Error('That role is no longer here.');
          }
          roles.push({ id: live.id, name: live.name, memberCount: live.members.length });
        }
        const approverId = input.approverRoleId;
        let approverRole: ApproverRole | null = null;
        if (approverId !== null) {
          const live = findMockRole(approverId);
          if (live === undefined) {
            throw new Error('That role is no longer here.');
          }
          approverRole = { id: live.id, name: live.name };
        }
        mockTopicRoles.set(topicId, { roles, approverRole });
        bumpRolesRevision();
      },
      start: () => {},
      stop: () => {},
      openChat: (chatId) => {
        set((state) => ({
          activeChatId: chatId,
          chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
        }));
        // Pins load when the chat opens, like the real store (the seeded
        // mock pins would otherwise never show in the banner).
        void get().refreshPins(chatId);
      },
      // The mock loads every message at once, so the hit is either there or
      // it is not: no paging, no wait, same `message_not_found` contract.
      openAtMessage: async (chatId, messageId) => {
        get().openChat(chatId);
        const found = get().messagesByChat[chatId]?.find((item) => item.id === messageId);
        if (found === undefined) {
          throw new Error('message_not_found');
        }
        set({ jumpTarget: { chatId, messageId } });
        return found;
      },
      clearJumpTarget: () => set({ jumpTarget: undefined }),
      sendText: (chatId, text, options) => {
        const trimmed = text.trim();
        if (!trimmed || !get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        messageCounter += 1;
        // T-0227: the composer forwards its tracked mentions; the mock keeps
        // them on the optimistic bubble (offsets are already into `trimmed`
        // in the tests, and the composer value is never padded here).
        const mentions = options?.mentions ?? [];
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: get().currentUserId,
          senderName: CURRENT_USER_NAME,
          text: trimmed,
          createdAt: new Date(),
          status: 'sending',
          ...(mentions.length === 0 ? {} : { mentions: [...mentions] }),
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
      sendSticker: (chatId, sticker, options) => {
        if (!get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        // Validate before the optimistic insert: a hostile value (tampered
        // recents) sets a visible error with no bubble, never a stuck send.
        const data = {
          pack_id: sticker.packId,
          sticker_id: sticker.stickerId,
          url: sticker.url,
          ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        };
        if (!isValid(StickerSchema)(data)) {
          set({ actionError: { chatId, message: 'That sticker could not be sent.' } });
          return;
        }
        messageCounter += 1;
        const body = sticker.emoji ?? '';
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: get().currentUserId,
          senderName: CURRENT_USER_NAME,
          text: body,
          createdAt: new Date(),
          status: 'sending',
          card: { v: 0, type: 'sticker', data },
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          // A later validated send clears this chat's stale error banner.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
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
      forwardMessages: (targets, messages, options) => {
        const comment = options?.comment?.trim();
        const visited = new Set<string>();
        for (const targetId of targets) {
          if (visited.has(targetId)) {
            continue;
          }
          visited.add(targetId);
          if (!get().chats.some((chat) => chat.id === targetId)) {
            continue;
          }
          let queued = false;
          for (const message of messages) {
            if (message.deleted === true) {
              continue;
            }
            messageCounter += 1;
            const copy: UiMessage = {
              id: `local-${Date.now()}-${messageCounter}`,
              chatId: targetId,
              senderId: get().currentUserId,
              senderName: CURRENT_USER_NAME,
              createdAt: new Date(),
              status: 'sending',
              forward: {
                sender_id: message.senderId,
                sender_name: message.senderName,
                original_at: message.createdAt.toISOString(),
              },
              ...(message.text === undefined ? {} : { text: message.text }),
              ...(message.card === undefined ? {} : { card: message.card }),
              ...(message.attachment === undefined ? {} : { attachment: message.attachment }),
              ...(message.voice === undefined ? {} : { voice: message.voice }),
            };
            set((state) => ({
              messagesByChat: {
                ...state.messagesByChat,
                [targetId]: [...(state.messagesByChat[targetId] ?? NO_MESSAGES), copy],
              },
              chats: state.chats.map((chat) =>
                chat.id === targetId ? { ...chat, lastMessage: copy } : chat,
              ),
            }));
            setTimeout(() => setStatus(targetId, copy.id, 'sent'), SENT_DELAY_MS);
            setTimeout(() => setStatus(targetId, copy.id, 'read'), READ_DELAY_MS);
            queued = true;
          }
          // The comment is a separate normal text message, only when this
          // target received at least one copy.
          if (queued && comment !== undefined && comment.length > 0) {
            get().sendText(targetId, comment);
          }
        }
      },
      retrySticker: (chatId, messageId) => {
        const message = get().messagesByChat[chatId]?.find((item) => item.id === messageId);
        const payload =
          message?.card !== undefined && message.card.type === 'sticker' ? message.card : undefined;
        if (message === undefined || payload === undefined) {
          return;
        }
        // A drifted payload that no longer validates stays failed.
        if (!isValid(StickerSchema)(payload.data)) {
          return;
        }
        set((state) => ({
          // A retry clears this chat's stale error banner with it.
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? NO_MESSAGES).map((item) =>
              item.id === messageId
                ? { ...clearMockFailure(item), status: 'sending' as const }
                : item,
            ),
          },
        }));
        setTimeout(() => setStatus(chatId, messageId, 'sent'), SENT_DELAY_MS);
        setTimeout(() => setStatus(chatId, messageId, 'read'), READ_DELAY_MS);
      },
      sendAttachment: (chatId, file, options) => {
        // Mock mode: the demo flow works without a server. Two demo
        // attachments (gradient images) validate through the same
        // `attachmentDataFor` wire shape the real store sends; the fake
        // served URL never leaves the device.
        if (!get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        // Only a REAL zero says "That file is empty": an unknown size is
        // never refused as empty.
        if (file.size !== undefined && file.size === 0) {
          set({ actionError: { chatId, message: 'That file is empty.' } });
          return;
        }
        if (file.size !== undefined && file.size > MAX_MOCK_ATTACHMENT_BYTES) {
          set({ actionError: { chatId, message: 'That file is larger than 50 MB.' } });
          return;
        }
        messageCounter += 1;
        const caption = options?.caption?.trim() ?? '';
        // A `gradient:` demo image keeps its URL so the bubble renders the
        // gradient tile; anything else gets a placeholder served URL.
        const data = attachmentDataFor(
          file,
          imageGradient(file.uri) === undefined
            ? `mock://attachments/${Date.now()}-${messageCounter}`
            : file.uri,
        );
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: get().currentUserId,
          senderName: CURRENT_USER_NAME,
          createdAt: new Date(),
          status: 'sending',
          attachment: data,
          ...(caption.length === 0 ? {} : { text: caption }),
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
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
      retryAttachment: (chatId, messageId) => {
        const message = get().messagesByChat[chatId]?.find((item) => item.id === messageId);
        if (message?.attachment === undefined) {
          return;
        }
        set((state) => ({
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? NO_MESSAGES).map((item) =>
              item.id === messageId
                ? { ...clearMockFailure(item), status: 'sending' as const }
                : item,
            ),
          },
        }));
        setTimeout(() => setStatus(chatId, messageId, 'sent'), SENT_DELAY_MS);
        setTimeout(() => setStatus(chatId, messageId, 'read'), READ_DELAY_MS);
      },
      cancelAttachment: (chatId, messageId) => {
        // Mock mode uploads settle instantly: cancelling a sending
        // attachment removes the optimistic bubble, like a delete.
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? NO_MESSAGES).filter(
              (item) => item.id !== messageId || item.status !== 'sending',
            ),
          },
        }));
      },
      sendVoice: (chatId, recording, options) => {
        // Mock mode: the demo voice message sends without a server. The
        // metadata rides the same `voice` payload shape the real store
        // sends, with the local URI as the playable URL.
        if (!get().chats.some((chat) => chat.id === chatId)) {
          return;
        }
        messageCounter += 1;
        const durationMs = Math.max(1, Math.round(recording.durationMs));
        const waveform = recording.waveform.length > 0 ? recording.waveform : [12];
        const message: UiMessage = {
          id: `local-${Date.now()}-${messageCounter}`,
          chatId,
          senderId: get().currentUserId,
          senderName: CURRENT_USER_NAME,
          createdAt: new Date(),
          status: 'sending',
          voice: {
            duration_ms: durationMs,
            mime: 'audio/mp4',
            waveform,
            ...(recording.uri === '' ? {} : { url: recording.uri }),
          },
          ...(options?.replyTo === undefined ? {} : { replyTo: options.replyTo }),
        };
        set((state) => ({
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
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
      retryVoice: (chatId, messageId) => {
        const message = get().messagesByChat[chatId]?.find((item) => item.id === messageId);
        if (message?.voice === undefined) {
          return;
        }
        set((state) => ({
          actionError: state.actionError?.chatId === chatId ? undefined : state.actionError,
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? NO_MESSAGES).map((item) =>
              item.id === messageId
                ? { ...clearMockFailure(item), status: 'sending' as const }
                : item,
            ),
          },
        }));
        setTimeout(() => setStatus(chatId, messageId, 'sent'), SENT_DELAY_MS);
        setTimeout(() => setStatus(chatId, messageId, 'read'), READ_DELAY_MS);
      },
      cancelVoice: (chatId, messageId) => {
        // Mock mode uploads settle instantly: cancelling a sending voice
        // removes the optimistic bubble, like a delete.
        set((state) => ({
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: (state.messagesByChat[chatId] ?? NO_MESSAGES).filter(
              (item) => item.id !== messageId || item.status !== 'sending',
            ),
          },
        }));
      },
      setSearch: (search) => set({ search }),
      setActiveFolder: (activeFolder) => set({ activeFolder }),
      setFolders: (folders) => {
        const sorted = sortFolders(folders);
        set((state) => ({
          folders: sorted,
          foldersLoaded: true,
          activeFolder:
            state.activeFolder === 'all' ||
            sorted.some((folder) => folder.id === state.activeFolder)
              ? state.activeFolder
              : 'all',
        }));
      },
      createFolder: async (input) => {
        const folder = {
          id: `mock-folder-${mockFolderSequence}`,
          name: input.name,
          icon: input.icon,
          position: get().folders.length,
          includeTypes: input.includeTypes ?? [],
          includeChats: input.includeChats ?? [],
          excludeChats: input.excludeChats ?? [],
          excludeMuted: input.excludeMuted ?? false,
          excludeRead: input.excludeRead ?? false,
        };
        mockFolderSequence += 1;
        get().setFolders([...get().folders, folder]);
        return folder;
      },
      updateFolder: async (id, input) => {
        const existing = get().folders.find((folder) => folder.id === id);
        if (existing === undefined) {
          throw new Error('This folder is not available.');
        }
        const folder = {
          ...existing,
          name: input.name ?? existing.name,
          icon: input.icon ?? existing.icon,
          includeTypes: input.includeTypes ?? existing.includeTypes,
          includeChats: input.includeChats ?? existing.includeChats,
          excludeChats: input.excludeChats ?? existing.excludeChats,
          excludeMuted: input.excludeMuted ?? existing.excludeMuted,
          excludeRead: input.excludeRead ?? existing.excludeRead,
        };
        get().setFolders(get().folders.map((item) => (item.id === id ? folder : item)));
        return folder;
      },
      deleteFolder: async (id) => {
        get().setFolders(get().folders.filter((item) => item.id !== id));
      },
      reorderFolders: async (ids) => {
        const folders = get().folders;
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const ordered: typeof folders = [];
        const seen = new Set<string>();
        for (const id of ids) {
          const folder = byId.get(id);
          if (folder !== undefined && !seen.has(id)) {
            seen.add(id);
            ordered.push({ ...folder, position: ordered.length });
          }
        }
        for (const folder of folders) {
          if (!seen.has(folder.id)) {
            seen.add(folder.id);
            ordered.push({ ...folder, position: ordered.length });
          }
        }
        get().setFolders(ordered);
      },
    };
  });
}

/** The build environment the mock gate needs, injected so it stays testable. */
export interface MockEnv {
  dev: boolean;
  envMock: string | undefined;
  nodeEnv: string | undefined;
}

/** The real build values: `__DEV__` is a React Native global, absent in tests. */
function currentMockEnv(): MockEnv {
  return {
    dev: typeof __DEV__ !== 'undefined' && __DEV__,
    envMock: process.env.EXPO_PUBLIC_ZILAR_MOCK,
    nodeEnv: process.env.NODE_ENV,
  };
}

/**
 * `?mock=1` (or `EXPO_PUBLIC_ZILAR_MOCK=1`) selects the mock store for local
 * UI work. Vitest also runs on the mock store. The real store is the default.
 * The route param is honored only when `mockParamAllowed` opens the gate, so a
 * production deep link cannot switch a real user to fake data.
 */
export function isMockMode(
  params?: Record<string, string | string[] | undefined>,
  env: MockEnv = currentMockEnv(),
): boolean {
  if (env.nodeEnv === 'test' || env.envMock === '1') {
    return true;
  }
  if (!mockParamAllowed({ dev: env.dev, envMock: env.envMock })) {
    return false;
  }
  const value = params?.['mock'];
  return value === '1' || (Array.isArray(value) && value.includes('1'));
}
