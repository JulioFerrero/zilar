import type { MessageStatus, UiMessage } from '@galena/chat-core';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type {
  CreatedInviteLink,
  CreateGroupInviteLinkInput,
  JoinPreview,
  JoinResult,
} from '../lib/invite-links-api';
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
  | 'reloadChats'
  | 'retryHistory'
  | 'hasMore'
  | 'sendText'
  | 'sendTyping'
  | 'react'
  | 'startEdit'
  | 'cancelEdit'
  | 'editMessage'
  | 'deleteForEveryone'
  | 'dismissActionError'
  | 'dismissTopicNotice'
  | 'groupDetail'
  | 'refreshGroupDetail'
  | 'muteChat'
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
    contacts: [],
    messagesByChat,
    historyLoad: loadedHistory,
    search: '',
    activeFolder: 'all',
    activeChatId: null,
    historyComplete: {},
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
    topicNotice: undefined,
    groupDetailsRevision: 0,
    ownedAis: mockDevteamOwnedAis(),
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

/** The mock store kept for `?mock=1` dev mode and unit tests. */
export function createChatStore(
  phase: MockDraftPhase | undefined = readMockDraftPhase(),
  load: MockLoadScenario | undefined = readMockLoadScenario(),
): UseBoundStore<StoreApi<ChatStoreState>> {
  return create<ChatStoreState>()((set, get) => {
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

    const bumpRolesRevision = () =>
      set((state) => ({ groupDetailsRevision: state.groupDetailsRevision + 1 }));

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
    // mock mode without a server.
    const inviteLinks = createMockInviteLinksStore();

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
        void get().groupDetailsRevision;
        return groupId === 'g-devteam' ? mockDevteamGroupDetail() : undefined;
      },
      refreshGroupDetail: () => {},
      ownedAis: mockDevteamOwnedAis(),
      muteChat: (chatId, muted) =>
        set((state) => ({
          chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, muted } : chat)),
        })),
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
        throw new Error('addTopicAi is not available in the mock store');
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
      previewJoinLink: async (token: string): Promise<JoinPreview> => inviteLinks.preview(token),
      joinByLink: async (token: string): Promise<JoinResult> => inviteLinks.join(token),
      groupRoles: (groupId) => {
        void get().groupDetailsRevision;
        return groupId === 'g-devteam' ? mockRoles.map((role) => ({ ...role })) : undefined;
      },
      refreshGroupRoles: async () => {},
      createGroupRole: async (chatId, name) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        if (chat?.groupId !== 'g-devteam') {
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
      renameGroupRole: async (_chatId, roleId, name) => {
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
      deleteGroupRole: async (_chatId, roleId) => {
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
      setGroupRoleMembers: async (_chatId, roleId, userIds) => {
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
        void get().groupDetailsRevision;
        const topicId = get().chats.find((entry) => entry.id === chatId)?.topic?.id;
        if (topicId === undefined) {
          return undefined;
        }
        const entry = topicRolesOf(topicId);
        return {
          roles: entry.roles.map((role) => ({ ...role })),
          approverRole: entry.approverRole === null ? null : { ...entry.approverRole },
        };
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
    envMock: process.env.EXPO_PUBLIC_GALENA_MOCK,
    nodeEnv: process.env.NODE_ENV,
  };
}

/**
 * `?mock=1` (or `EXPO_PUBLIC_GALENA_MOCK=1`) selects the mock store for local
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
