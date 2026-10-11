import { sortByRecency } from './effects/chatRows';
import { makeChatActions } from './effects/chatActions';
import { makeGroupActions } from './effects/groupActions';
import { createStoreLocals } from './effects/locals';
import { portsLayer, readPorts, type RealStoreDeps } from './effects/ports';
import { makeLifetime } from './effects/runtime';
import { makeStoreContext } from './effects/storeContext';
import { createAtomStore, type StoreApi } from './atomStore';
import type { ChatStoreState } from './store';

export { CONNECT_RETRY_DELAYS_MS, TOPIC_REFRESH_INTERVAL_MS } from './effects/constants';
export { mergeWithPainted, summariesFor } from './effects/chatRows';

export { SEND_TIMEOUT_MS } from './effects/constants';
export { sendFailureReasonFor } from './effects/sendFailure';
export { DRAFT_END_FALLBACK_MS, DRAFT_IDLE_MS } from './effects/constants';

export type { ApiClient, RealStoreDeps, StorageLike } from './effects/ports';

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const ports = readPorts(portsLayer(deps));
  const rt = makeLifetime(ports);

  return createAtomStore<ChatStoreState>((set, get) => {
    // The closure's mutable locals (the handles, caches and per-session maps),
    // owned by one object so the helpers and the actions share them.
    const locals = createStoreLocals();

    // The ledger, the plain helpers and the context the effect modules and
    // the actions share (`effects/storeContext.ts`).
    const { ctx } = makeStoreContext({ locals, ports, rt, set, get });

    return {
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      // Unknown means never requested, and the real store never has data
      // without requesting it: that is still loading, never empty.
      historyStateFor: (chatId) => get().historyState[chatId] ?? 'loading',
      chats: [],
      contacts: [],
      chatPrefs: {},
      defaultBackground: null,
      messagesByChat: {},
      reactions: {},
      pinsByChat: {},
      pinsReady: {},
      pinsError: undefined,
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      edits: {},
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      messages: (chatId) => get().messagesByChat[chatId] ?? [],
      groupMembers: (chatId) => [...(locals.groupMembers.get(chatId)?.values() ?? [])],
      groupInfo: (chatId) => get().groupInfos[chatId],
      topicNotice: undefined,
      hasMore: (chatId) =>
        get().historyComplete[chatId] !== true && locals.cursors[chatId] !== undefined,
      pins: (chatId) => get().pinsByChat[chatId] ?? [],
      pinsLoaded: (chatId) => get().pinsReady[chatId] === true,
      canPin: (chatId) => {
        const state = get();
        const chat = state.chats.find((entry) => entry.id === chatId);
        if (chat === undefined) {
          return false;
        }
        // Either side of a DM may pin.
        if (chat.kind === 'dm') {
          return true;
        }
        // A topic manager: a group owner/admin (roles ride the group
        // detail loaded on open), or the topic creator. The creator edge
        // without a manager role is enforced by the server; the menu hides
        // until the detail loads rather than guessing.
        const role = state.groupInfos[chatId]?.members.find(
          (member) => member.userId === state.currentUserId,
        )?.role;
        return role === 'owner' || role === 'admin';
      },
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinsPanel: undefined,
      archivedChats: () =>
        sortByRecency(
          get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
        ),
      ...makeChatActions({ ctx, rt, locals, set, get, ports }),
      ...makeGroupActions({ ctx, rt, locals, set, get, ports }),
    };
  });
}
