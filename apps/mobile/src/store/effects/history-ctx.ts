import type {
  HistoryCtx,
  HistoryLoad,
  HistoryPatch,
  HistorySet,
  HistoryState,
} from '@zilar/client-core/store';

import type { ChatStoreState, LoadState } from '../types';
import type { StoreCtx } from './runtime';

const toCoreLoad = (load: LoadState): HistoryLoad => (load === 'loaded' ? 'ready' : load);
const toMobileLoad = (load: HistoryLoad): LoadState => (load === 'ready' ? 'loaded' : load);

export function makeHistoryCtx(ctx: StoreCtx): HistoryCtx {
  const { get, set, s } = ctx;

  const asHistoryState = (state: ChatStoreState): HistoryState => ({
    ...state,
    historyState: Object.fromEntries(
      Object.entries(state.historyLoad).map(([chatId, load]) => [chatId, toCoreLoad(load)]),
    ),
  });

  const asMobilePatch = (patch: HistoryPatch): Partial<ChatStoreState> => {
    if (patch.historyState === undefined) {
      return patch;
    }
    const { historyState, ...rest } = patch;
    return {
      ...rest,
      historyLoad: Object.fromEntries(
        Object.entries(historyState).map(([chatId, load]) => [chatId, toMobileLoad(load)]),
      ),
    };
  };

  const historySet: HistorySet = (update) => {
    set((state) => {
      const previous = asHistoryState(state);
      const patch = typeof update === 'function' ? update(previous) : update;
      // `clearSupersededMarker` returns the state it was given to skip the write; keep the store's "same object" convention.
      if (patch === previous) {
        return state;
      }
      return asMobilePatch(patch);
    });
  };

  // `rt`, `k`, `fx`, the ports, `lastRead` and the bookkeeping are the same objects the rest of the core uses, so a read mark or cursor written here is visible everywhere.
  const historyCtx: HistoryCtx = {
    get: () => asHistoryState(get()),
    set: historySet,
    ports: ctx.coreCtx.ports,
    rt: ctx.coreCtx.rt,
    k: ctx.coreCtx.k,
    fx: ctx.coreCtx.fx,
    get core() {
      return s.core;
    },
    set core(value) {
      s.core = value;
    },
    get lastRead() {
      return s.lastRead;
    },
    set lastRead(value) {
      s.lastRead = value;
    },
    lastReadUserId: ctx.coreCtx.lastReadUserId,
    pendingOutgoing: s.pendingOutgoing,
    get groupsJoined() {
      return s.groupsJoined;
    },
    set groupsJoined(value) {
      s.groupsJoined = value;
    },
    get pendingOpenChatId() {
      return s.pendingOpenChatId;
    },
    set pendingOpenChatId(value) {
      s.pendingOpenChatId = value;
    },
    cursors: s.cursors,
    loadingHistory: s.loadingHistory,
    loadingOlder: s.loadingOlder,
  };

  return historyCtx;
}
