import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CoreState } from './ctx';
import {
  PAGE_HISTORY_MAX,
  canLoadHistory,
  clearSupersededMarker,
  flushPending,
  loadOlder,
  loadOlderPage,
  loadPreview,
  openAtMessage,
  openHistory,
  type HistoryCtx,
  type HistoryState,
} from './history';
import { ANA, TEAM, dm, team, testCtx } from './test-ctx';

/** `count` messages from Ana, `ana-0` the oldest, one minute apart. */
function anaHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'chat',
    chatJid: ANA,
    id: `ana-${index}`,
    fromJid: ANA,
    fromResolved: true,
    body: `msg ${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 6, index)),
    outgoing: false,
  }));
}

const ids = (count: number, from = 0): string[] =>
  Array.from({ length: count }, (_, index) => `ana-${from + index}`);

type LoadHistory = XmppCore['loadHistory'];

/** A MAM fake over a list, paging like the server: `before` an id, newest `max`. */
function serverOver(list: ChatMessage[]): LoadHistory {
  return async (_chatJid, _kind, options) => {
    const max = options?.max ?? PAGE_HISTORY_MAX;
    const before = options?.before;
    const end = before === undefined ? list.length : list.findIndex((item) => item.id === before);
    const start = Math.max(0, end - max);
    const messages = list.slice(start, end);
    const first = messages[0]?.id;
    return { messages, complete: start === 0, ...(first === undefined ? {} : { first }) };
  };
}

/** A history context over the core test context, online, with the groups joined. */
function historyCtx(
  options: { loadHistory?: LoadHistory; state?: Partial<HistoryState>; noCore?: boolean } = {},
) {
  const openChat = vi.fn();
  const loadHistory = vi.fn(options.loadHistory ?? serverOver(anaHistory(60)));
  const base = testCtx({
    core: { loadHistory },
    state: {
      status: 'online',
      historyState: {},
      historyComplete: {},
      openChat,
      ...options.state,
    } as Partial<CoreState>,
  });
  const ctx = Object.assign(base.ctx, {
    groupsJoined: true,
    pendingOpenChatId: undefined,
    cursors: {},
    loadingHistory: new Set<string>(),
    loadingOlder: new Set<string>(),
  }) as HistoryCtx;
  if (options.noCore === true) {
    ctx.core = undefined;
  }
  const state = (): HistoryState => ctx.get();
  const shown = (): string[] => (state().messagesByChat[ANA] ?? []).map((message) => message.id);
  return { ...base, ctx, state, shown, openChat, loadHistory };
}

describe('canLoadHistory (core)', () => {
  it('needs a core and an online status; a group also needs its rooms joined', () => {
    const { ctx } = historyCtx();
    expect(canLoadHistory(ctx, dm)).toBe(true);
    ctx.groupsJoined = false;
    expect(canLoadHistory(ctx, dm)).toBe(true);
    expect(canLoadHistory(ctx, team)).toBe(false);
    expect(canLoadHistory(historyCtx({ state: { status: 'connecting' } }).ctx, dm)).toBe(false);
    expect(canLoadHistory(historyCtx({ noCore: true }).ctx, dm)).toBe(false);
  });
});

describe('openHistory (core)', () => {
  it('loads the newest page, marks it read and sets the cursor', async () => {
    const { ctx, core, state, shown } = historyCtx();

    await Effect.runPromise(openHistory(ctx, ANA));

    expect(shown()).toEqual(ids(50, 10));
    expect(state().historyState[ANA]).toBe('ready');
    expect(state().historyComplete[ANA]).toBe(false);
    expect(ctx.cursors[ANA]).toBe('ana-10');
    expect(ctx.lastRead[ANA]).toBe('ana-59');
    expect(core.markDisplayed).toHaveBeenCalledWith(ANA, 'chat', 'ana-59');
    expect(state().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
    expect(ctx.loadingHistory.size).toBe(0);
  });

  it('remembers a chat that cannot load yet, and flushPending loads it later', async () => {
    const { ctx, state, shown, rt } = historyCtx({ state: { status: 'connecting' } });

    await Effect.runPromise(openHistory(ctx, ANA));
    expect(ctx.pendingOpenChatId).toBe(ANA);
    expect(state().historyState[ANA]).toBe('loading');
    expect(shown()).toEqual([]);

    ctx.set({ status: 'online' } as never);
    flushPending(ctx);
    expect(ctx.pendingOpenChatId).toBeUndefined();
    await vi.waitFor(() => {
      expect(state().historyState[ANA]).toBe('ready');
    });
    expect(shown()).toHaveLength(50);
    rt.closeStore();
  });

  it('marks the chat error when the page fails', async () => {
    const { ctx, state } = historyCtx({
      loadHistory: async () => {
        throw new Error('mam down');
      },
    });

    await Effect.runPromise(openHistory(ctx, ANA));

    expect(state().historyState[ANA]).toBe('error');
    expect(ctx.loadingHistory.size).toBe(0);
  });
});

describe('loadOlderPage (core)', () => {
  it('prepends the older page and moves the cursor back', async () => {
    const { ctx, shown, state } = historyCtx();
    await Effect.runPromise(openHistory(ctx, ANA));

    await Effect.runPromise(loadOlderPage(ctx, ANA, 'ana-10'));

    expect(shown()).toEqual(ids(60));
    expect(ctx.cursors[ANA]).toBe('ana-0');
    expect(state().historyComplete[ANA]).toBe(true);
  });

  it('keeps each message once when the page overlaps what is loaded', async () => {
    const { ctx, shown } = historyCtx();
    await Effect.runPromise(openHistory(ctx, ANA));

    // The boot preview's cursor is the newest message: this page is ana-9..58.
    await Effect.runPromise(loadOlderPage(ctx, ANA, 'ana-59'));

    expect(shown()).toEqual(ids(51, 9));
    expect(ctx.cursors[ANA]).toBe('ana-9');
  });

  it('does nothing while another older page of the chat is loading', async () => {
    const { ctx, loadHistory } = historyCtx();
    ctx.loadingOlder.add(ANA);

    await Effect.runPromise(loadOlderPage(ctx, ANA, 'ana-10'));

    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('leaves the cursor for a retry when the page fails', async () => {
    const { ctx } = historyCtx({
      loadHistory: async () => {
        throw new Error('mam down');
      },
    });
    ctx.cursors[ANA] = 'ana-10';

    await Effect.runPromise(loadOlderPage(ctx, ANA, 'ana-10'));

    expect(ctx.cursors[ANA]).toBe('ana-10');
    expect(ctx.loadingOlder.size).toBe(0);
  });
});

describe('loadOlder (core)', () => {
  it('does nothing without a cursor, and pages from the cursor otherwise', async () => {
    const { ctx, loadHistory, shown, rt } = historyCtx();

    loadOlder(ctx, ANA);
    expect(loadHistory).not.toHaveBeenCalled();

    ctx.cursors[ANA] = 'ana-50';
    loadOlder(ctx, ANA);
    await vi.waitFor(() => {
      expect(shown()).toEqual(ids(50));
    });
    expect(loadHistory).toHaveBeenCalledWith(ANA, 'chat', { before: 'ana-50', max: 50 });
    rt.closeStore();
  });
});

describe('loadPreview (core)', () => {
  it('sets the preview, a first last-read mark and the cursor', async () => {
    const { ctx, state } = historyCtx();

    await Effect.runPromise(loadPreview(ctx, ctx.core as XmppCore, dm));

    expect(state().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
    expect(ctx.lastRead[ANA]).toBe('ana-59');
    expect(ctx.cursors[ANA]).toBe('ana-59');
    expect(state().historyComplete[ANA]).toBe(false);
    expect(state().messagesByChat[ANA]).toBeUndefined();
  });

  it('keeps an earlier last-read mark', async () => {
    const { ctx } = historyCtx();
    ctx.lastRead[ANA] = 'ana-3';

    await Effect.runPromise(loadPreview(ctx, ctx.core as XmppCore, dm));

    expect(ctx.lastRead[ANA]).toBe('ana-3');
  });
});

describe('openAtMessage (core)', () => {
  it('opens the chat and pages back until the message is loaded', async () => {
    const { ctx, openChat, shown } = historyCtx({ loadHistory: serverOver(anaHistory(120)) });
    await Effect.runPromise(openHistory(ctx, ANA));

    const found = await Effect.runPromise(openAtMessage(ctx, ANA, 'ana-3'));

    expect(found.text).toBe('msg 3');
    expect(openChat).toHaveBeenCalledWith(ANA);
    expect(shown()).toEqual(ids(120));
  });

  it('fails with message_not_found once history is complete', async () => {
    const { ctx } = historyCtx();
    await Effect.runPromise(openHistory(ctx, ANA));

    const error = await Effect.runPromise(Effect.flip(openAtMessage(ctx, ANA, 'ghost')));

    expect(error.message).toBe('message_not_found');
  });

  it('looks only at loaded messages while history cannot load', async () => {
    const { ctx, loadHistory } = historyCtx({ state: { status: 'offline' } });

    const error = await Effect.runPromise(Effect.flip(openAtMessage(ctx, TEAM, 'ana-1')));

    expect(error.message).toBe('message_not_found');
    expect(loadHistory).not.toHaveBeenCalled();
  });
});

describe('clearSupersededMarker (core)', () => {
  it('drops a loading marker, and keeps settled ones and in-flight loads', () => {
    const { ctx, state } = historyCtx({
      state: { historyState: { [ANA]: 'loading', [TEAM]: 'ready' } },
    });

    clearSupersededMarker(ctx, TEAM);
    expect(state().historyState).toEqual({ [ANA]: 'loading', [TEAM]: 'ready' });

    ctx.loadingHistory.add(ANA);
    clearSupersededMarker(ctx, ANA);
    expect(state().historyState[ANA]).toBe('loading');

    ctx.loadingHistory.delete(ANA);
    clearSupersededMarker(ctx, ANA);
    expect(state().historyState).toEqual({ [TEAM]: 'ready' });
  });
});
