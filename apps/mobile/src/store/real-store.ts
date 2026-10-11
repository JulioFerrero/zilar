import type { UiMessage } from '@zilar/chat-core';
import {
  clearFailure,
  coreKind,
  recordRead,
  signatureFor,
  sortByRecency,
  sortMessages,
  stickerSignatureFor,
  type CoreApi,
  type CoreCtx,
  type CorePorts,
} from '@zilar/client-core/store';
import { Effect } from 'effect';
import { createAtomStore, type StoreApi } from './atomStore';

import type { ChatEntry } from '../lib/chat-api';
import { makeEvents } from './effects/events';
import { makeGroups } from './effects/groups';
import { makeHistory } from './effects/history';
import { makeLifecycle } from './effects/lifecycle';
import { makePins } from './effects/pins';
import { makeSend } from './effects/send';
import { Ports, PortsLive, type RealStoreDeps } from './effects/ports';
import { makeLife, makeRunners, type StoreCtx, type StoreState } from './effects/runtime';
import { createStoreLocals } from './effects/locals';
import { makeStoreHelpers } from './effects/helpers';
import { makeUserState, type UserState } from './effects/user-state';
import { isUpdateStanza, summariesFor } from './effects/chat-rows';
import type { ChatStoreState } from './types';

export { MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS } from './effects/history';
export {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  PINS_REFRESH_INTERVAL_MS,
  TOPIC_REFRESH_INTERVAL_MS,
} from './effects/polling';
export { isUpdateStanza, summariesFor };

export type { AppStateLike, RealStoreDeps } from './effects/ports';

// One shared empty list: a selector must return the same reference while
// nothing changed, or React re-renders forever ("Maximum update depth").
const EMPTY_MESSAGES: UiMessage[] = [];

/**
 * The real store: the same behaviour as the web (`apps/web/src/store/realStore.ts`)
 * with mobile storage/AppState seams. It loads chats and contacts over HTTP,
 * connects `xmpp-core`, and turns its events into store updates.
 */
export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  // Every outside dependency comes from the `Ports` layer (injected or live).
  const ports = Effect.runSync(Ports.use(Effect.succeed).pipe(Effect.provide(PortsLive(deps))));
  const { appState } = ports;

  return createAtomStore<ChatStoreState>((set, get) => {
    // The closure's mutable locals (the handles, caches and per-session maps),
    // owned by one object so the helpers below share them.
    const locals = createStoreLocals();

    // The state the effect modules share. The members that code in this
    // closure still reads by their old names are bridged to those names.
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

    // The plain helpers (the ledger, the row and group caches, the failure
    // markers), built from the locals and the set/get pair.
    const helpers = makeStoreHelpers({ locals, get, set, appState });

    // Late-bound: the effect modules are built from the context below, and the
    // teardown they call needs them, so it is assigned once they exist.
    let userState!: UserState;

    // The core's view of this store (`@zilar/client-core/store`): the incoming
    // handlers, the message actions, the reads and history run on it. Mobile
    // saves no last-read map and has no app badge or push notifications to
    // sync. History and the lifecycle live in adapters (`effects/history.ts`,
    // `effects/lifecycle.ts`), which map the mobile `historyLoad` names to the
    // core `historyState` names.
    const coreApi: CoreApi = {
      getMe: () => ports.api.getMe(),
      getChats: () => ports.api.getChats(),
      getContacts: () => ports.api.getContacts(),
      getXmppToken: () => ports.api.getXmppToken(),
      // The chat prefs ride the boot (T-0135); a missing client reads none.
      listChatPrefs: () => ports.chatPrefs?.listChatPrefs() ?? Promise.resolve([]),
    };
    const corePorts: CorePorts = {
      now: ports.now,
      isVisible: helpers.isVisible,
      // Mobile keeps no last-read map on disk (T-0915): in memory only.
      storage: null,
      api: coreApi,
      rows: { summariesFor: (entry) => summariesFor(entry as ChatEntry) },
      createXmpp: ports.createXmpp,
      visibility: ports.visibility,
      drafts: ports.openDrafts,
      notifications: { syncBadge: () => {}, dismissChat: () => {} },
      // Q3 (R7) is yes: mobile retries the connection like web, and a resume
      // reconnects (R8). Both are mobile-only switches.
      flags: { connectRetry: true, reconnectOnResume: true },
    };
    const coreCtx: CoreCtx = {
      get,
      set,
      ports: corePorts,
      rt: life.lifetime,
      k: helpers.ledger,
      fx: {
        syncBadge: () => {},
        dismissChatNotifications: () => {},
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
    };

    // The effect modules, built once the closure's helpers exist. `fx` bridges
    // the concerns that still live in this closure as Promise functions.
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
        joinGroups: (current, me) => groups.joinGroups(current, me),
        ensureGroupDetail: (groupId, force) => groups.ensureGroupDetail(groupId, force),
        ensureGroupMembers: (chatId) => groups.ensureGroupMembers(chatId),
        scheduleChatsRefresh: () => events.scheduleChatsRefresh(),
        // The core's own pins poll (started at boot) refreshes the active chat;
        // `openChat` starts it for the chat it opens, `stopPinsPoll` stops it.
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
      ...makeRunners(ports, life),
    };
    const lifecycle = makeLifecycle(ctx);
    const history = makeHistory(ctx);
    const send = makeSend(ctx);
    const groups = makeGroups(ctx);
    const events = makeEvents(ctx);
    const pins = makePins(ctx);

    userState = makeUserState({
      locals,
      s,
      set,
      ownedAis: ports.ownedAis,
      ledger: helpers.ledger,
      events,
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
      // Stop the open chat's pins poll (the core's poll reads this switch).
      stopPinsPoll: () => {
        locals.pinsPollEnabled = false;
      },
      setSearch: (value) => set({ search: value }),
      setActiveFolder: (folder) => set({ activeFolder: folder }),
      start: lifecycle.start,
      stop: lifecycle.stop,
    };
  });
}
