import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import type { UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CoreState } from './ctx';
import type { CorePorts } from './ports';
import {
  PAGE_HISTORY_MAX,
  PREVIEW_HISTORY_MAX,
  canLoadHistory,
  clearSupersededMarker,
  flushPending,
  loadOlder,
  loadOlderPage,
  loadPreview,
  openAtMessage,
  openHistory,
  type HistoryCtx,
  type HistoryPatch,
  type HistoryState,
} from './history';
import { loadPreviews } from './previews';
import { previewMessageOf } from './row-helpers';
import { ANA, ME, TEAM, dm, team, testCtx } from './test-ctx';

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
  options: {
    loadHistory?: LoadHistory;
    state?: Partial<HistoryState>;
    ports?: Partial<CorePorts>;
    noCore?: boolean;
  } = {},
) {
  const openChat = vi.fn();
  const loadHistory = vi.fn(options.loadHistory ?? serverOver(anaHistory(60)));
  const base = testCtx({
    core: { loadHistory },
    ...(options.ports === undefined ? {} : { ports: options.ports }),
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
    const { ctx, core, state, shown } = historyCtx({ state: { activeChatId: ANA } });

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
    const { ctx, state, shown, rt } = historyCtx({
      state: { status: 'connecting', activeChatId: ANA },
    });

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

  it('loads a group once its own room is joined, before every room', async () => {
    const { ctx, loadHistory, rt, state } = historyCtx({ state: { activeChatId: TEAM } });
    ctx.groupsJoined = false;
    ctx.joinedRooms = new Set();
    expect(canLoadHistory(ctx, team)).toBe(false);

    await Effect.runPromise(openHistory(ctx, TEAM));
    expect(ctx.pendingOpenChatId).toBe(TEAM);
    expect(loadHistory).not.toHaveBeenCalled();

    // `onJoined` fires for this room while the other rooms still queue, and
    // the pending open flushes without waiting for `groupsJoined`.
    ctx.joinedRooms.add(TEAM);
    flushPending(ctx);
    expect(canLoadHistory(ctx, team)).toBe(true);
    expect(ctx.pendingOpenChatId).toBeUndefined();
    await vi.waitFor(() => {
      expect(state().historyState[TEAM]).toBe('ready');
    });
    expect(loadHistory).toHaveBeenCalledWith(TEAM, 'groupchat', expect.anything());
    rt.closeStore();
  });

  it('the mobile history adapter sees the joined rooms through fx', () => {
    const { ctx } = historyCtx();
    ctx.groupsJoined = false;
    const rooms = new Set<string>([TEAM]);
    ctx.joinedRooms = rooms;
    const adapter: HistoryCtx = {
      ...ctx,
      joinedRooms: new Set<string>(),
      fx: { ...ctx.fx, joinedRooms: rooms },
    };
    expect(canLoadHistory(adapter, team)).toBe(true);
  });

  it('marks the chat error when the page fails', async () => {
    const { ctx, state } = historyCtx({
      state: { activeChatId: ANA },
      loadHistory: async () => {
        throw new Error('mam down');
      },
    });

    await Effect.runPromise(openHistory(ctx, ANA));

    expect(state().historyState[ANA]).toBe('error');
    expect(ctx.loadingHistory.size).toBe(0);
  });

  it('a page that lands after closeChat sends no marker and keeps unread', async () => {
    const chats = [{ ...dm, unread: 3 }];
    const { ctx, core, state, shown } = historyCtx({ state: { activeChatId: ANA, chats } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: LoadHistory = async (...args) => {
      await gate;
      return serverOver(anaHistory(60))(...args);
    };
    const gatedLoad = vi.fn(gated);
    ctx.core = { ...(ctx.core as XmppCore), loadHistory: gatedLoad } as XmppCore;

    const run = Effect.runPromise(openHistory(ctx, ANA));
    await vi.waitFor(() => {
      expect(ctx.loadingHistory.has(ANA)).toBe(true);
    });
    // The user leaves before the page lands: the deferred open is dropped.
    // `activeChatId` is not part of `HistoryPatch`, so the cast mirrors what
    // the apps' own `set` accepts for their full state.
    ctx.set({ activeChatId: undefined } as unknown as HistoryPatch);
    ctx.pendingOpenChatId = undefined;
    clearSupersededMarker(ctx, ANA);
    release();
    await run;

    expect(shown()).toHaveLength(50);
    expect(state().historyState[ANA]).toBe('ready');
    expect(core.markDisplayed).not.toHaveBeenCalled();
    expect(ctx.lastRead[ANA]).toBeUndefined();
    expect(state().chats.find((chat) => chat.id === ANA)?.unread).toBe(3);
  });

  it('a page for the open, visible chat still marks seen', async () => {
    const { ctx, core, state } = historyCtx({ state: { activeChatId: ANA } });

    await Effect.runPromise(openHistory(ctx, ANA));

    expect(state().historyState[ANA]).toBe('ready');
    expect(ctx.lastRead[ANA]).toBe('ana-59');
    expect(core.markDisplayed).toHaveBeenCalledWith(ANA, 'chat', 'ana-59');
  });
});

describe('loadOlderPage (core)', () => {
  it('prepends the older page and moves the cursor back', async () => {
    const { ctx, shown, state } = historyCtx({ state: { activeChatId: ANA } });
    await Effect.runPromise(openHistory(ctx, ANA));

    await Effect.runPromise(loadOlderPage(ctx, ANA, 'ana-10'));

    expect(shown()).toEqual(ids(60));
    expect(ctx.cursors[ANA]).toBe('ana-0');
    expect(state().historyComplete[ANA]).toBe(true);
  });

  it('keeps each message once when the page overlaps what is loaded', async () => {
    const { ctx, shown } = historyCtx({ state: { activeChatId: ANA } });
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
  it('sets the preview and the cursor, and never marks read', async () => {
    const { ctx, state } = historyCtx();

    await Effect.runPromise(loadPreview(ctx, ctx.core as XmppCore, dm));

    expect(state().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
    expect(ctx.lastRead[ANA]).toBeUndefined();
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

describe('loadPreviews (core)', () => {
  it('a reconnect skips chats whose preview and cursor are already known', async () => {
    const preview = { id: 'ana-59' } as UiMessage;
    const { ctx, loadHistory } = historyCtx({
      state: {
        chats: [
          { ...dm, lastMessage: preview },
          { ...team, lastMessage: preview },
        ],
      },
    });
    ctx.cursors[ANA] = 'ana-59';
    ctx.cursors[TEAM] = 'team-59';

    await Effect.runPromise(loadPreviews(ctx, ctx.core as XmppCore));

    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('still previews a chat whose list row has no lastMessage', async () => {
    const { ctx, loadHistory, state } = historyCtx({ state: { chats: [dm] } });
    ctx.cursors[ANA] = 'ana-59';

    await Effect.runPromise(loadPreviews(ctx, ctx.core as XmppCore));

    expect(loadHistory).toHaveBeenCalledWith(ANA, 'chat', { max: PREVIEW_HISTORY_MAX });
    expect(state().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
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
    const { ctx } = historyCtx({ state: { activeChatId: ANA } });
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

  it('finds a loaded message by the archive id its chat preview carries', async () => {
    // T-1739: an AI question card is re-keyed on the server to the message's
    // archive id, and the row is keyed by the stanza id it was stored under.
    // The archive id only reaches the client on the chat preview
    // (`previewMessageOf` -> `lastMessage.archiveId`), beside the origin id the
    // stanza links to. Build row and preview through their real writers.
    const archiveId = '1792170770205830';
    const { ctx } = historyCtx({ state: { status: 'offline' } });
    const card = ctx.k.toUiMessage(
      {
        id: 'stanza-7',
        originId: 'origin-1',
        chatJid: ANA,
        fromJid: ANA,
        fromResolved: true,
        timestamp: new Date(Date.UTC(2026, 9, 16, 6)),
        outgoing: false,
        body: 'Which iOS should I test on?',
      },
      ME,
    );
    const preview = previewMessageOf(ANA, {
      id: 'origin-1',
      text: 'Which iOS should I test on?',
      at: '2026-10-16T06:00:00.000Z',
      archiveId,
    });
    ctx.set({
      messagesByChat: { [ANA]: [card] },
      chats: [{ ...dm, ...(preview === undefined ? {} : { lastMessage: preview }) }],
    });

    const found = await Effect.runPromise(openAtMessage(ctx, ANA, archiveId));

    expect(found.id).toBe('stanza-7');
  });

  it('finds a MAM-loaded card by its archive id, not just the chat preview (T-1980)', async () => {
    // Julio pinned a card whose live id happened to be its archive id
    // (`pins.ts` stores whatever id the row has). Later, a reload loads it
    // through MAM: the forwarded stanza carries a `<stanza-id>` that
    // `resolve-sender.ts` prefers over the raw archive id, so the row's
    // displayed id differs from the pin. The card is not the chat's newest
    // message, so the old preview-only lookup (`:281`) cannot help.
    const archiveId = '1792170770205830';
    const card: ChatMessage = {
      kind: 'chat',
      chatJid: ANA,
      id: 'card-stanza-7',
      archiveId,
      fromJid: ANA,
      fromResolved: true,
      body: 'Which iOS should I test on?',
      timestamp: new Date(Date.UTC(2026, 9, 16, 6, 0)),
      outgoing: false,
    };
    const later: ChatMessage = {
      kind: 'chat',
      chatJid: ANA,
      id: 'ana-later',
      fromJid: ANA,
      fromResolved: true,
      body: 'a later message',
      timestamp: new Date(Date.UTC(2026, 9, 16, 6, 1)),
      outgoing: false,
    };
    const { ctx } = historyCtx({ loadHistory: serverOver([card, later]) });
    await Effect.runPromise(openHistory(ctx, ANA));

    const found = await Effect.runPromise(openAtMessage(ctx, ANA, archiveId));

    expect(found.id).toBe('card-stanza-7');
  });

  it('keeps the origin id as the wire target after aliasing the archive id (T-1980)', async () => {
    // Reactions and replies name `wireTargetFor(row.id)`; the other person only
    // knows the origin id, never this user's own archive id.
    const archiveId = '1792170770205830';
    const card: ChatMessage = {
      kind: 'chat',
      chatJid: ANA,
      id: 'card-stanza-7',
      originId: 'origin-7',
      archiveId,
      fromJid: ANA,
      fromResolved: true,
      body: 'Which iOS should I test on?',
      timestamp: new Date(Date.UTC(2026, 9, 16, 6, 0)),
      outgoing: false,
    };
    const { ctx } = historyCtx({ loadHistory: serverOver([card]) });
    await Effect.runPromise(openHistory(ctx, ANA));

    const found = await Effect.runPromise(openAtMessage(ctx, ANA, archiveId));

    expect(found.id).toBe('card-stanza-7');
    expect(ctx.k.wireTargetFor(found.id)).toBe('origin-7');
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

describe('reply quotes (core)', () => {
  it('resolves a same-page reply name before inserting', async () => {
    const list = anaHistory(2).map((message) =>
      message.id === 'ana-1' ? { ...message, replyTo: { id: 'ana-0' } } : message,
    );
    const { ctx, state } = historyCtx({
      loadHistory: serverOver(list),
      state: { activeChatId: ANA },
    });

    await Effect.runPromise(openHistory(ctx, ANA));

    const reply = state().messagesByChat[ANA]?.find((message) => message.id === 'ana-1');
    expect(reply?.replyTo?.senderName).toBe('Ana');
    expect(reply?.replyTo?.text).toBe('msg 0');
  });

  it('names a reply from its `to` JID when the target is not loaded', async () => {
    const list = anaHistory(2).map((message) =>
      message.id === 'ana-1' ? { ...message, replyTo: { id: 'ghost', to: ANA } } : message,
    );
    const { ctx, state } = historyCtx({
      loadHistory: serverOver(list),
      state: { activeChatId: ANA },
    });

    await Effect.runPromise(openHistory(ctx, ANA));

    const reply = state().messagesByChat[ANA]?.find((message) => message.id === 'ana-1');
    expect(reply?.replyTo?.senderName).toBe('Ana');
    expect(reply?.replyTo?.senderId).toBe(ANA);
  });
});
