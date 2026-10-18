import { sortByRecency } from './effects/chatRows';
import { makeChatActions } from './effects/chatActions';
import { makeGroupActions } from './effects/groupActions';
import { createStoreLocals } from './effects/locals';
import { portsLayer, readPorts, type RealStoreDeps } from './effects/ports';
import { makeLifetime } from './effects/runtime';
import { scheduleMessageSave } from './effects/lifecycle';
import { makeStoreContext } from './effects/storeContext';
import { createAtomStore, type SetState, type StoreApi } from '@zilar/client-core';
import { canPinFor } from '@zilar/client-core/store';
import type { ChatStoreState } from './store';

export { CONNECT_RETRY_DELAYS_MS, TOPIC_REFRESH_INTERVAL_MS } from './effects/constants';
export { mergeWithPainted, summariesFor } from './effects/chatRows';

export { SEND_TIMEOUT_MS } from './effects/constants';
export { sendFailureReasonFor } from '@zilar/client-core/store';
export { DRAFT_END_FALLBACK_MS, DRAFT_IDLE_MS } from './effects/constants';

export type { ApiClient, RealStoreDeps, StorageLike } from './effects/ports';

export function createRealChatStore(deps: RealStoreDeps = {}): StoreApi<ChatStoreState> {
  const ports = readPorts(portsLayer(deps));
  const rt = makeLifetime(ports);

  return createAtomStore<ChatStoreState>((set, get) => {
    const locals = createStoreLocals();

    // Every message change goes through this setter, so the cache is written about 2 s after
    // the last stanza instead of on every one.
    let onMessagesChanged: () => void = () => undefined;
    const setWithMessageCache: SetState<ChatStoreState> = (partial, replace) => {
      const before = get().messagesByChat;
      set(partial, replace);
      if (get().messagesByChat !== before) {
        onMessagesChanged();
      }
    };

    const { ctx } = makeStoreContext({ locals, ports, rt, set: setWithMessageCache, get });
    onMessagesChanged = () => scheduleMessageSave(ctx);

    return {
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      // Unknown means never requested, and the real store never has data without requesting
      // it: that is still loading, never empty.
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
        const role = state.groupInfos[chatId]?.members.find(
          (member) => member.userId === state.currentUserId,
        )?.role;
        return canPinFor(chat, role);
      },
      pinFor: (chatId, messageId) =>
        (get().pinsByChat[chatId] ?? []).find((pin) => pin.messageId === messageId),
      pinsPanel: undefined,
      archivedChats: () =>
        sortByRecency(
          get().chats.filter((chat) => chat.archived === true && chat.topic === undefined),
        ),
      ...makeChatActions({ ctx, rt, locals, set: setWithMessageCache, get, ports }),
      ...makeGroupActions({ ctx, rt, locals, set: setWithMessageCache, get, ports }),
    };
  });
}
