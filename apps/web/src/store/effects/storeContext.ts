import {
  createMessageLedger,
  createTextOutbox,
  type MessageLedger,
} from '@zilar/client-core/store';
import type { ChatEntry, Me } from '@/lib/api';
import { loadInTabPreviews, showInTabNotification } from '@/lib/push/inTab';
import type { SetState } from '@zilar/client-core';
import type { ChatStoreState } from '../store';
import { summariesFor } from './chatRows';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import { scheduleChatsRefresh } from './history';
import {
  applyBoot,
  applyStop,
  joinGroupsNow,
  prepareStart,
  refreshActiveChatPinsNow,
  refreshChatsNow,
  rememberGroupIds as rememberGroupIdsHook,
} from './lifecycle';
import type { StoreLocals } from './locals';
import { clearDraftTimeout, markTurnFinished } from '@zilar/client-core/store';
import type { PortsShape } from './ports';
import { saveChatList as saveChatListHook } from './reads';
import type { Lifetime } from './runtime';

export interface StoreContextDeps {
  readonly locals: StoreLocals;
  readonly ports: PortsShape;
  readonly rt: Lifetime;
  readonly set: SetState<ChatStoreState>;
  readonly get: () => ChatStoreState;
}

/** The ledger, the plain helpers (removeFailedMessage, rememberGroupIds, nick) and the
 * StoreCtx, bridging the closure's locals to the names the core modules read. */
export function makeStoreContext(deps: StoreContextDeps): {
  ctx: StoreCtx;
  ledger: MessageLedger;
} {
  const { locals, ports, rt, set, get } = deps;

  const ledger = createMessageLedger({
    get,
    set,
    memberName: (chatId, localpart) => locals.groupMembers.get(chatId)?.get(localpart)?.name,
    occupantNick: (chatId, fromJid) =>
      locals.core
        ?.occupants(chatId)
        .find((item) => item.realJid === fromJid || item.jid === fromJid)?.nick,
    mediaToken: () => locals.mediaToken,
  });

  // Removes a failed local bubble together with its kept bytes.
  function removeFailedMessage(chatId: string, messageId: string): void {
    locals.pendingAttachments.delete(ledger.aliasRoot(messageId));
    locals.pendingAttachments.delete(messageId);
    ledger.removeFailedMessage(chatId, messageId);
  }

  function rememberGroupIds(entries: ChatEntry[]): void {
    for (const entry of entries) {
      if (entry.kind === 'group') {
        for (const row of summariesFor(entry)) {
          locals.groupIds.set(row.id, entry.groupId);
        }
      }
    }
  }

  function nick(me: Me): string {
    const name = me.name.trim();
    if (name.length > 0) {
      return name;
    }
    return me.jid?.split('@')[0] ?? 'me';
  }

  // What the Effect modules share; the accessors read and write the closure variables.
  const ctx: StoreCtx = {
    get,
    set,
    ports,
    rt,
    k: {
      ...ledger,
      removeFailedMessage,
      rememberGroupIds,
      nick,
    },
    fx: {
      syncBadge: () => ports.notifications.syncBadge(get().chats),
      dismissChatNotifications: (chatId) => ports.notifications.dismissChat(chatId),
      loadGroupMembers: (chatId) => loadGroupMembersInBackground(ctx, chatId),
      finishDraftTurn: (chatId, turnId) => {
        markTurnFinished(ctx, turnId);
        clearDraftTimeout(ctx, chatId);
      },
      forgetRetryBytes: (messageId) => {
        locals.pendingVoices.delete(messageId);
        locals.pendingAttachments.delete(messageId);
      },
      notifyIncoming: (chatId, message) => {
        const chat = get().chats.find((entry) => entry.id === chatId);
        showInTabNotification(chat, {
          ...message,
          originId: ctx.messageOriginIds.get(message.id),
        });
      },
      prepareStart: () => prepareStart(ctx),
      setStatus: (status) => set({ status }),
      setChatsLoad: (load) => set({ chatsState: load }),
      applyBoot: (input) => {
        applyBoot(ctx, input);
        loadInTabPreviews();
      },
      rememberGroupIds: (entries) => rememberGroupIdsHook(ctx, entries),
      scheduleChatsRefresh: () => scheduleChatsRefresh(ctx),
      refreshChats: () => refreshChatsNow(ctx),
      refreshActiveChatPins: (chatId) => refreshActiveChatPinsNow(ctx, chatId),
      joinGroups: (core, me, hooks) => joinGroupsNow(ctx, core, me, hooks),
      saveChatList: () => saveChatListHook(ctx),
      refreshDefaultBackground: () => {
        void ctx.get().refreshDefaultBackground();
      },
      setMediaTrustedHosts: (hosts) => set({ mediaTrustedHosts: hosts }),
      applyStop: () => applyStop(ctx),
    },
    get core() {
      return locals.core;
    },
    set core(value) {
      locals.core = value;
    },
    get groupsJoined() {
      return locals.groupsJoined;
    },
    set groupsJoined(value) {
      locals.groupsJoined = value;
    },
    get joinedRooms() {
      return locals.joinedRooms;
    },
    set joinedRooms(value) {
      locals.joinedRooms = value;
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
    get lastRead() {
      return locals.lastRead;
    },
    set lastRead(value) {
      locals.lastRead = value;
    },
    get lastReadUserId() {
      return locals.lastReadUserId;
    },
    set lastReadUserId(value) {
      locals.lastReadUserId = value;
    },
    cachedUserId: undefined,
    started: false,
    boot: undefined,
    connectRetryAttempt: 0,
    connectRetryPending: false,
    groupIds: locals.groupIds,
    loadingGroupMembers: locals.loadingGroupMembers,
    groupMembers: locals.groupMembers,
    groupInfos: locals.groupInfos,
    messageAuthors: ledger.messageAuthors,
    messageOriginIds: ledger.messageOriginIds,
    messageBaseTexts: ledger.messageBaseTexts,
    finishedTurns: locals.finishedTurns,
    finishedTurnOrder: locals.finishedTurnOrder,
    cursors: locals.cursors,
    loadingHistory: locals.loadingHistory,
    loadingOlder: locals.loadingOlder,
    quietArchiveIds: locals.quietArchiveIds,
    sequence: 0,
    pendingOutgoing: locals.pendingOutgoing,
    pendingAttachments: locals.pendingAttachments,
    pendingVoices: locals.pendingVoices,
    sendRuns: locals.sendRuns,
    // The text outbox: texts stay sending until the stream-management ack marks them sent.
    // The lifecycle flushes it on online and reset() clears it on sign-out, so one user's
    // queue never goes out as another user's.
    outbox: createTextOutbox(),
  };

  return { ctx, ledger };
}
