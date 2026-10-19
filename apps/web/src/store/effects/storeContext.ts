import {
  bridgeLocals,
  createCoreLedger,
  createTextOutbox,
  nickFor,
  type MessageLedger,
} from '@zilar/client-core/store';
import type { ChatEntry } from '@/lib/api';
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

  const ledger = createCoreLedger({
    get,
    set,
    locals,
    memberName: (chatId, localpart) => locals.groupMembers.get(chatId)?.get(localpart)?.name,
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
      nick: nickFor,
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
    core: locals.core,
    groupsJoined: locals.groupsJoined,
    joinedRooms: locals.joinedRooms,
    pendingOpenChatId: locals.pendingOpenChatId,
    mediaToken: locals.mediaToken,
    lastRead: locals.lastRead,
    lastReadUserId: locals.lastReadUserId,
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
  bridgeLocals(locals, ctx, [
    'core',
    'groupsJoined',
    'joinedRooms',
    'pendingOpenChatId',
    'mediaToken',
    'lastRead',
    'lastReadUserId',
  ]);

  return { ctx, ledger };
}
