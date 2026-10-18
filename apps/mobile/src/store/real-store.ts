import type { UiMessage } from '@zilar/chat-core';
import {
  clearFailure,
  coreKind,
  createTextOutbox,
  recordRead,
  signatureFor,
  sortByRecency,
  sortMessages,
  stickerSignatureFor,
  type CoreApi,
  type CoreCtx,
  type CorePorts,
  type JoinGroupsHooks,
} from '@zilar/client-core/store';
import { Effect } from 'effect';
import { createAtomStore, type StoreApi } from '@zilar/client-core';

import type { ChatEntry } from '../lib/chat-api';
import { dismissChatNotifications, syncBadge } from '../lib/push/badge';
import { markStartup, startupTimingEnabled } from '../lib/startup-timing';
import { makeEvents } from './effects/events';
import { makeGroups } from './effects/groups';
import { makeHistory } from './effects/history';
import { makeLifecycle } from './effects/lifecycle';
import { makePins } from './effects/pins';
import { makePushPair } from './effects/push-pair';
import { makeSend } from './effects/send';
import { Ports, PortsLive, type RealStoreDeps } from './effects/ports';
import { makeLife, makeRunners, type StoreCtx, type StoreState } from './effects/runtime';
import { createStoreLocals } from './effects/locals';
import { makeStoreHelpers } from './effects/helpers';
import { makeUserState, type UserState } from './effects/user-state';
import { isUpdateStanza, summariesFor } from './effects/chat-rows';
import { createOfflineCacheSync } from './offline-cache-sync';
import type { ChatStoreState } from './types';

export { MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS } from './effects/history';
export {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  PINS_REFRESH_INTERVAL_MS,
  TOPIC_REFRESH_INTERVAL_MS,
} from '@zilar/client-core/store';
export { isUpdateStanza, summariesFor };

export type { AppStateLike, RealStoreDeps } from './effects/ports';

// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_MESSAGES: UiMessage[] = [];

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const ports = Effect.runSync(Ports.use(Effect.succeed).pipe(Effect.provide(PortsLive(deps))));
  const { appState } = ports;
  const offline = createOfflineCacheSync(deps);

  const store = createAtomStore<ChatStoreState>((set, get) => {
    const locals = createStoreLocals();

    const life = makeLife();
    const s: StoreState = {
      get core() {
        return locals.core;
      },
      set core(value) {
        locals.core = value;
      },
      started: false,
      firstToken: undefined,
      boot: undefined,
      cursors: locals.cursors,
      finishedTurns: new Set<string>(),
      finishedTurnOrder: [],
      loadingHistory: locals.loadingHistory,
      loadingOlder: locals.loadingOlder,
      groupIds: locals.groupIds,
      pendingOutgoing: locals.pendingOutgoing,
      sequence: 0,
      sendRuns: new Map(),
      pendingUploads: locals.pendingUploads,
      pendingVoices: locals.pendingVoices,
      groupDetails: locals.groupDetails,
      loadingGroupDetails: locals.loadingGroupDetails,
      groupRolesById: locals.groupRolesById,
      loadingGroupRoles: locals.loadingGroupRoles,
      topicRolesById: locals.topicRolesById,
      loadingTopicRoles: locals.loadingTopicRoles,
      groupMembers: locals.groupMembers,
      get groupsJoined() {
        return locals.groupsJoined;
      },
      set groupsJoined(value) {
        locals.groupsJoined = value;
      },
      get pendingOpenChatId() {
        return locals.pendingOpenChatId;
      },
      set pendingOpenChatId(value) {
        locals.pendingOpenChatId = value;
      },
      get mediaToken() {
        return locals.mediaToken;
      },
      set mediaToken(value) {
        locals.mediaToken = value;
      },
      get mediaTrustedHosts() {
        return locals.mediaTrustedHosts;
      },
      set mediaTrustedHosts(value) {
        locals.mediaTrustedHosts = value;
      },
      get lastRead() {
        return locals.lastRead;
      },
      set lastRead(value) {
        locals.lastRead = value;
      },
      get chatPrefRows() {
        return locals.chatPrefRows;
      },
      set chatPrefRows(value) {
        locals.chatPrefRows = value;
      },
    };

    const helpers = makeStoreHelpers({ locals, get, set, appState });

    let userState!: UserState;

    const coreApi: CoreApi = {
      getMe: () => ports.api.getMe(),
      getChats: () => ports.api.getChats(),
      getContacts: () => ports.api.getContacts(),
      getXmppToken: () => ports.api.getXmppToken(),
      markChatRead:
        ports.api.markChatRead === undefined
          ? undefined
          : (jid, messageId) => ports.api.markChatRead?.(jid, messageId) as Promise<unknown>,
      markChatDelivered:
        ports.api.markChatDelivered === undefined
          ? undefined
          : (jid, originIds) => ports.api.markChatDelivered?.(jid, originIds) as Promise<unknown>,
      deleteMessageForMe:
        ports.api.deleteMessageForMe === undefined
          ? undefined
          : (jid, archiveId) => ports.api.deleteMessageForMe?.(jid, archiveId) as Promise<unknown>,
      clearChatHistory:
        ports.api.clearChatHistory === undefined
          ? undefined
          : (jid) => ports.api.clearChatHistory?.(jid) as Promise<unknown>,
      listChatPrefs: () => ports.chatPrefs?.listChatPrefs() ?? Promise.resolve([]),
    };
    const corePorts: CorePorts = {
      now: ports.now,
      isVisible: helpers.isVisible,
      storage: null,
      api: coreApi,
      rows: { summariesFor: (entry) => summariesFor(entry as ChatEntry) },
      createXmpp: ports.createXmpp,
      visibility: ports.visibility,
      drafts: ports.openDrafts,
      notifications: {
        syncBadge: (chats) => {
          Effect.runFork(syncBadge(chats));
        },
        dismissChat: (chatId) => {
          Effect.runFork(dismissChatNotifications(chatId));
        },
      },
      flags: { connectRetry: true, reconnectOnResume: true },
      // A session revoked on the server answers 401 on `GET /api/me`, so `authFailed` signs out to login instead of retrying for ever.
      checkSession: () => ports.checkSession(),
      sessionGone: () => ports.sessionGone(),
    };
    const coreCtx: CoreCtx = {
      get,
      set,
      ports: corePorts,
      rt: life.lifetime,
      k: helpers.ledger,
      fx: {
        syncBadge: () => {
          Effect.runFork(syncBadge(coreCtx.get().chats));
        },
        dismissChatNotifications: (chatId) => {
          Effect.runFork(dismissChatNotifications(chatId));
        },
        loadGroupMembers: (chatId) => {
          ctx.forkSession(ctx.fx.ensureGroupMembers(chatId));
        },
        finishDraftTurn: (chatId, turnId) => {
          lifecycle.finishDraftTurn(chatId, turnId);
        },
        forgetRetryBytes: (messageId) => {
          locals.pendingUploads.delete(messageId);
          locals.pendingVoices.delete(messageId);
        },
        joinedRooms: locals.joinedRooms,
      },
      get core() {
        return locals.core;
      },
      set core(value) {
        locals.core = value;
      },
      get lastRead() {
        return locals.lastRead;
      },
      set lastRead(value) {
        locals.lastRead = value;
      },
      lastReadUserId: undefined,
      pendingOutgoing: locals.pendingOutgoing,
      // Texts stay `sending` until the server's stream-management ack marks them `sent`; `teardown()` clears the outbox on sign-out, so one user's queue never goes out as another user.
      outbox: createTextOutbox(),
    };

    const ctx: StoreCtx = {
      ports,
      get,
      set,
      s,
      life,
      h: {
        sortByRecency,
        summariesFor,
        ...helpers,
        coreKind,
        sortMessages,
        recordRead: (chatId, messageId) => recordRead(coreCtx, chatId, messageId),
        signatureFor,
        stickerSignatureFor,
        clearFailure,
        teardown: () => userState.teardown(),
      },
      fx: {
        get loadPrefRows() {
          return history.loadPrefRows;
        },
        get loadFolders() {
          return history.loadFolders;
        },
        get refreshChats() {
          return history.refreshChats;
        },
        loadPreview: (current, chat) => history.loadPreview(current, chat),
        loadPins: (chatId, loud) => pins.loadPins(chatId, loud),
        joinGroups: (current, me, hooks?: JoinGroupsHooks) => groups.joinGroups(current, me, hooks),
        ensureGroupDetail: (groupId, force) => groups.ensureGroupDetail(groupId, force),
        ensureGroupMembers: (chatId) => groups.ensureGroupMembers(chatId),
        scheduleChatsRefresh: () => events.scheduleChatsRefresh(),
        startPinsPolling: () => {
          locals.pinsPollEnabled = true;
        },
        refreshActiveChatPins: (chatId) => {
          if (locals.pinsPollEnabled) {
            ctx.forkSession(pins.loadPins(chatId, false));
          }
        },
        restartBoot: () => lifecycle.restartBoot(),
      },
      coreCtx,
      offline,
      ...makeRunners(ports, life),
    };
    const lifecycle = makeLifecycle(ctx);
    const history = makeHistory(ctx);
    const send = makeSend(ctx);
    const groups = makeGroups(ctx);
    const events = makeEvents(ctx);
    const pins = makePins(ctx);
    const pushPair = makePushPair(ctx);

    userState = makeUserState({
      locals,
      s,
      set,
      ownedAis: ports.ownedAis,
      ledger: helpers.ledger,
      events,
      clearPins: () => pins.clear(),
    });

    return {
      ...userState.initialUserState(),
      status: 'offline',
      edits: {},
      reactions: {},
      drafts: {},
      finishedDraftMessages: {},
      mediaTrustedHosts: undefined,
      messages: (chatId) => get().messagesByChat[chatId] ?? EMPTY_MESSAGES,
      hasMore: (chatId) =>
        get().historyComplete[chatId] !== true && locals.cursors[chatId] !== undefined,
      groupMembers: (chatId) => helpers.mentionMembersFor(chatId),
      groupIdForChat: (chatId) => helpers.groupIdForChat(chatId),
      openChat: (chatId) => history.openChat(chatId),
      closeChat: (chatId) => {
        if (get().activeChatId === chatId) {
          set({ activeChatId: null });
        }
        // A deferred open must not fire later for a chat that was left: drop the pending open and its `loading` marker.
        if (locals.pendingOpenChatId === chatId) {
          locals.pendingOpenChatId = undefined;
          if (!locals.loadingHistory.has(chatId) && get().historyLoad[chatId] === 'loading') {
            const next = { ...get().historyLoad };
            delete next[chatId];
            set({ historyLoad: next });
          }
        }
      },
      reloadChats: () => history.reloadChats(),
      retryHistory: (chatId) => history.retryHistory(chatId),
      loadOlder: (chatId) => history.loadOlder(chatId),
      openAtMessage: (chatId, messageId) => history.openAtMessage(chatId, messageId),
      clearJumpTarget: () => set({ jumpTarget: undefined }),
      ...send,
      ...events.actions,
      dismissTopicNotice: () => set({ topicNotice: undefined }),
      groupDetailsRevision: 0,
      ...groups.actions,
      ...pins.actions,
      ...pushPair.actions,
      stopPinsPoll: () => {
        locals.pinsPollEnabled = false;
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      start: lifecycle.start,
      stop: lifecycle.stop,
    };
  });

  offline.watch(store);

  // Dev-only cold-start marks; `startupTimingEnabled()` is false in a release build, so the subscription is not created there.
  if (startupTimingEnabled()) {
    store.subscribe((state, previous) => {
      if (state.chatsLoad === 'loaded' && previous.chatsLoad !== 'loaded') {
        markStartup('chat-list');
      }
      if (state.status === 'online' && previous.status !== 'online') {
        markStartup('xmpp-online');
      }
    });
  }

  return store;
}
