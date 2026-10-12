// Builds the message ledger, the plain helpers of `realStore.ts` and the
// `StoreCtx` the effect modules and the actions share, from the store's
// mutable locals, ports, lifetime and state accessors.
import {
  createMessageLedger,
  createTextOutbox,
  type MessageLedger,
} from '@zilar/client-core/store';
import type { ChatEntry, Me } from '@/lib/api';
import { loadInTabPreviews, showInTabNotification } from '@/lib/push/inTab';
import type { SetState } from '../atomStore';
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
import { clearDraftTimeout, markTurnFinished } from './polling';
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

/**
 * The ledger, the plain helpers (`removeFailedMessage`, `rememberGroupIds`,
 * `nick`) and the `StoreCtx`. The closure's mutable locals are bridged to the
 * names the core modules read, and `x` now reads `locals.x`.
 */
export function makeStoreContext(deps: StoreContextDeps): {
  ctx: StoreCtx;
  ledger: MessageLedger;
} {
  const { locals, ports, rt, set, get } = deps;

  // Message ids and aliases, edits, reactions, mentions, sender names and
  // the message mutators (`@zilar/client-core/store`).
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

  // Removes a failed local bubble together with its kept bytes (T-0168).
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

  // What the Effect modules share. The accessors read and write the
  // closure variables the helpers above still use.
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
    // The web code the core modules call (`CoreHooks` and `StoreAppHooks`).
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
      joinGroups: (core, me) => joinGroupsNow(ctx, core, me),
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
    // The text outbox (F4, honest ticks): one per store instance. Texts stay
    // `sending` until the server's stream-management ack marks them `sent`;
    // the core lifecycle flushes it on online and `reset()` clears it on
    // sign-out, so one user's queue never goes out as another user.
    outbox: createTextOutbox(),
  };

  return { ctx, ledger };
}
