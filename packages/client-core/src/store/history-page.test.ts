import { groupMessages } from '@zilar/chat-core';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { CoreCtx, CoreSet } from './ctx';
import { loadOlderPage, openHistory, type HistoryCtx, type HistoryState } from './history';
import { createMessageLedger } from './ledger';
import { sortMessages } from './rows';
import { ANA, testCtx } from './test-support';

const stanza = (fields: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  kind: 'chat',
  chatJid: ANA,
  fromJid: ANA,
  fromResolved: true,
  outgoing: false,
  timestamp: new Date(Date.UTC(2026, 8, 28, 6, 0)),
  ...fields,
});

const message = (index: number): ChatMessage =>
  stanza({
    id: `ana-${index}`,
    body: `msg ${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 6, index)),
  });

const newest = Array.from({ length: 20 }, (_, index) => message(index + 10));
const olderMessages = Array.from({ length: 10 }, (_, index) => message(index));
const reactions = [2, 4, 12, 15, 25].map((target, index) =>
  stanza({
    id: `react-${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 7, index)),
    reactions: { targetId: `ana-${target}`, emojis: ['👍'] },
  }),
);
const corrections = [1, 3, 11, 14, 29].map((target, index) =>
  stanza({
    id: `fix-${index}`,
    body: `fixed ${target}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
    correction: { targetId: `ana-${target}` },
  }),
);
const olderPage = [...olderMessages, ...reactions, ...corrections];

function pagedCtx() {
  const loadHistory = vi.fn(async (_chat: string, _kind: string, options?: { before?: string }) =>
    options?.before === undefined
      ? { messages: newest, complete: false, first: 'ana-10' }
      : { messages: olderPage, complete: true, first: 'ana-0' },
  );
  const base = testCtx({
    core: { loadHistory } as unknown as Partial<XmppCore>,
    state: { status: 'online', historyState: {}, historyComplete: {}, openChat: vi.fn() } as never,
  });
  const notifications = { count: 0 };
  const set: CoreSet = (update) => {
    notifications.count += 1;
    base.ctx.set(update);
  };
  const k = createMessageLedger({
    get: base.ctx.get,
    set,
    memberName: () => undefined,
    occupantNick: () => undefined,
    mediaToken: () => undefined,
  });
  const ctx = Object.assign({ ...base.ctx, set, k } satisfies CoreCtx, {
    groupsJoined: true,
    pendingOpenChatId: undefined,
    cursors: {},
    loadingHistory: new Set<string>(),
    loadingOlder: new Set<string>(),
  }) as unknown as HistoryCtx;
  const state = (): HistoryState => ctx.get();
  return { ctx, state, notifications };
}

async function openNewest(h: ReturnType<typeof pagedCtx>): Promise<void> {
  await Effect.runPromise(openHistory(h.ctx, ANA));
}

describe('loadOlderPage: one store update per page', () => {
  it('notifies the store once for a page with 5 reactions and 5 corrections', async () => {
    const h = pagedCtx();
    await openNewest(h);
    h.notifications.count = 0;

    await Effect.runPromise(loadOlderPage(h.ctx, ANA, 'ana-10'));

    expect(h.notifications.count).toBe(1);
    const shown = h.state().messagesByChat[ANA] ?? [];
    expect(shown.map((item) => item.id)).toEqual(
      Array.from({ length: 30 }, (_, index) => `ana-${index}`),
    );
    expect(h.state().historyComplete[ANA]).toBe(true);
    expect(shown.find((item) => item.id === 'ana-1')?.text).toBe('fixed 1');
    expect(shown.find((item) => item.id === 'ana-29')?.text).toBe('fixed 29');
    expect(shown.find((item) => item.id === 'ana-25')?.reactions?.[0]?.emoji).toBe('👍');
  });

  it('ends in the state the unbatched, stanza by stanza path reaches', async () => {
    const batched = pagedCtx();
    await openNewest(batched);
    await Effect.runPromise(loadOlderPage(batched.ctx, ANA, 'ana-10'));

    const plain = pagedCtx();
    await openNewest(plain);
    const { k } = plain.ctx;
    for (const item of reactions) {
      k.ingestReaction(item);
    }
    for (const item of corrections) {
      k.ingestEdit(item);
    }
    const loaded = plain.ctx.get().messagesByChat[ANA] ?? [];
    const older = olderMessages.map((item) =>
      k.toUiMessage(item, plain.ctx.get().currentUserId, olderPage),
    );
    k.resolvePendingEdits(ANA);
    const withEdits = older.map((item) => k.withEdits(item, ANA));
    plain.ctx.set((previous) => ({
      messagesByChat: {
        ...previous.messagesByChat,
        [ANA]: sortMessages([...withEdits, ...loaded]),
      },
    }));
    k.refreshEdits(ANA);

    const batchedState = batched.state();
    const plainState = plain.state();
    expect(batchedState.messagesByChat[ANA]).toEqual(plainState.messagesByChat[ANA]);
    expect(batchedState.edits).toEqual(plainState.edits);
    expect(batchedState.reactions).toEqual(plainState.reactions);
  });
});

describe('day separators', () => {
  it('keeps the separator key of a day when an older page of the same day arrives', async () => {
    const h = pagedCtx();
    await openNewest(h);
    const separators = () =>
      groupMessages(h.state().messagesByChat[ANA] ?? [])
        .filter((entry) => entry.kind === 'separator')
        .map((entry) => entry.id);
    const before = separators();

    await Effect.runPromise(loadOlderPage(h.ctx, ANA, 'ana-10'));

    expect(before).toHaveLength(1);
    expect(before[0]).toMatch(/^day:\d{4}-\d{2}-\d{2}$/);
    expect(separators()).toEqual(before);
  });
});
