// The bridge between the mobile store and the core history modules: it maps the
// mobile state names (`historyLoad`/`'loaded'`) to the core's
// (`historyState`/`'ready'`) and hands the core the same ports, runtime and
// bookkeeping objects the rest of the core uses.
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

/**
 * Builds the core `HistoryCtx` over the mobile store: every read adapts the
 * mobile state to the core's `HistoryState` names, and every patch maps back.
 */
export function makeHistoryCtx(ctx: StoreCtx): HistoryCtx {
  const { get, set, s } = ctx;

  // The core's `HistoryState` over the mobile state: only the load-map name
  // and its `'ready'`/`'loaded'` value differ.
  const asHistoryState = (state: ChatStoreState): HistoryState => ({
    ...state,
    historyState: Object.fromEntries(
      Object.entries(state.historyLoad).map(([chatId, load]) => [chatId, toCoreLoad(load)]),
    ),
  });

  // A core patch back to the mobile names: `historyState` becomes
  // `historyLoad`, everything else passes through.
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
      // `clearSupersededMarker` returns the state it was given to skip the
      // write; keep the store's "same object" convention.
      if (patch === previous) {
        return state;
      }
      return asMobilePatch(patch);
    });
  };

  // The view of this store the core history modules run on. `rt`, `k`, `fx`,
  // the ports, `lastRead` and the mutable bookkeeping are the same objects the
  // rest of the core uses, so a read mark or a cursor written here is visible
  // everywhere.
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
